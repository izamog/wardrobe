/**
 * Turning a detected garment outline into a crop rectangle.
 *
 * All of the risk in auto-cropping lives here rather than in the vision call:
 * a model returning a slightly loose box is fine, a box turned into a rectangle
 * that falls off the edge of the image is a crash or a black band. Kept pure so
 * every one of those cases can be tested without a network or a device.
 *
 * The *visual* margin a tile shows around a garment is handled at display
 * time instead (see components/FramedImage.tsx), not here — a margin baked
 * into a crop can only ever come from real background pixels the photo
 * happened to include, and a tightly-framed photo has none to give, so
 * sizing the visual look off the crop would be inconsistent from one photo
 * to the next.
 *
 * That does not make this function a bare tight crop, though: growing
 * towards TARGET_ASPECT here is still load-bearing, as a safety margin
 * against the detected box itself being wrong. The vision call returns a
 * best guess, not a certainty, and a box that stops short of the actual hem
 * or waistband crops that fabric away for good — display-time margin cannot
 * bring back a pixel this step already discarded. Growing towards a portrait
 * shape absorbs a moderately-wrong box into extra background instead of into
 * a lost edge; a bare tight crop does not have that slack.
 */

/** A garment's outline as fractions of the image, 0-1, origin top-left. */
export interface NormalizedBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A crop rectangle in pixels, in the shape expo-image-manipulator wants. */
export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Width divided by height this function grows a crop towards.
 *
 * Not chosen for how the result looks — that's FramedImage's job now — but
 * because garments are usually taller than they are wide (or square), so
 * growing towards a portrait shape is, in the ordinary case, growing towards
 * more of the same photo the garment is actually in, which is exactly the
 * slack that absorbs a detected box that stopped short of the real edge.
 */
export const TARGET_ASPECT = 3 / 4;

/**
 * Buffer added around a detected box, as a fraction of the box's own size on
 * each side, before growing towards TARGET_ASPECT.
 *
 * Sized as a safety margin against detection being wrong, not as a visual
 * target — the vision model is asked to draw the box slightly generous
 * rather than tight (see DETECTION_INSTRUCTIONS in services/vision.ts), but
 * still tends to clip sleeves, hems and waistbands, especially where a pale
 * or cream garment blends into the white background it's photographed
 * against. A cropped-away edge is unrecoverable — nothing downstream can put
 * a pixel back that this step already discarded — so this errs generous.
 */
const SAFETY_PAD = 0.15;

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Reads a detected box, or returns null if it is unusable.
 *
 * The model is an input source, not an authority: it returns coordinates in
 * the wrong order, outside 0-1, or as strings often enough that trusting them
 * would mean cropping to a negative rectangle. A null here simply falls back
 * to the whole photo.
 */
export function parseDetectedBox(raw: unknown): NormalizedBox | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x0, y0, x1, y1 } = raw as Record<string, unknown>;
  if (![x0, y0, x1, y1].every(isFraction)) return null;

  // Accept either corner ordering rather than rejecting a transposed box.
  const box = {
    x0: Math.min(x0 as number, x1 as number),
    y0: Math.min(y0 as number, y1 as number),
    x1: Math.max(x0 as number, x1 as number),
    y1: Math.max(y0 as number, y1 as number),
  };

  // A zero-width or zero-height box describes nothing to crop to.
  if (box.x1 - box.x0 <= 0 || box.y1 - box.y0 <= 0) return null;
  return box;
}

/**
 * Converts a detected outline into a crop rectangle centred on the garment.
 *
 * With no box (nothing detected), returns the whole photo untouched — with
 * no information about where the garment is, cropping down to some assumed
 * shape would just as likely cut into it as not, and the display layer
 * letterboxes any aspect ratio equally well.
 *
 * The steps: pad by SAFETY_PAD, grow towards TARGET_ASPECT, shrink if that
 * overflowed the image, then restore anything the shrink took from the
 * padded box, and finally slide the result inside the bounds. Sliding rather
 * than clipping keeps the shape intact — clipping an overhanging rectangle
 * would silently change its ratio.
 *
 * The padded box (garment plus SAFETY_PAD) is always what the final
 * rectangle is measured against and never shrunk below, so the detected
 * garment itself can never end up outside the crop — only SAFETY_PAD and the
 * TARGET_ASPECT growth can shrink, when the photo has no more background left
 * to give. See the "contains the whole detected garment" test in
 * cropGeometry.test.ts for the property this guarantees.
 *
 * Always returns a rectangle inside the image, whatever it is given.
 */
export function cropRectFor(
  box: NormalizedBox | null,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return { originX: 0, originY: 0, width: 0, height: 0 };
  }

  if (box === null) {
    return { originX: 0, originY: 0, width: Math.round(imageWidth), height: Math.round(imageHeight) };
  }

  const paddedWidth = Math.min((box.x1 - box.x0) * imageWidth * (1 + SAFETY_PAD * 2), imageWidth);
  const paddedHeight = Math.min((box.y1 - box.y0) * imageHeight * (1 + SAFETY_PAD * 2), imageHeight);
  const centerX = ((box.x0 + box.x1) / 2) * imageWidth;
  const centerY = ((box.y0 + box.y1) / 2) * imageHeight;

  // Grow the short side towards the target ratio.
  let width = Math.max(paddedWidth, paddedHeight * TARGET_ASPECT);
  let height = width / TARGET_ASPECT;

  // That may not fit. Shrink proportionally...
  const scale = Math.min(1, imageWidth / width, imageHeight / height);
  width *= scale;
  height *= scale;

  // ...then give back whatever the shrink took off the padded box itself.
  // This is where the ratio is allowed to slip, and only ever to keep the
  // safety margin around the garment whole.
  width = Math.min(Math.max(width, paddedWidth), imageWidth);
  height = Math.min(Math.max(height, paddedHeight), imageHeight);

  const originX = Math.min(Math.max(centerX - width / 2, 0), imageWidth - width);
  const originY = Math.min(Math.max(centerY - height / 2, 0), imageHeight - height);

  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(width),
    height: Math.round(height),
  };
}
