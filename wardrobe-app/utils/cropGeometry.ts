/**
 * Turning a detected garment outline into a crop rectangle.
 *
 * All of the risk in auto-cropping lives here rather than in the vision call:
 * a model returning a slightly loose box is fine, a box turned into a rectangle
 * that falls off the edge of the image is a crash or a black band. Kept pure so
 * every one of those cases can be tested without a network or a device.
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
 * Width divided by height of a stored photo.
 *
 * 3:4 portrait, because garments are taller than they are wide and the closet
 * grid shows them at this ratio. Cropping to it here means the tile displays
 * the whole piece rather than trimming it again at render time.
 */
export const TARGET_ASPECT = 3 / 4;

/**
 * Fraction of the detected box added on each side.
 *
 * A box drawn tight to the garment reads as cramped, and detection tends to
 * clip sleeves and hems slightly. 6% is enough to breathe without floating the
 * piece in empty space.
 */
const LEEWAY = 0.06;

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Reads a detected box, or returns null if it is unusable.
 *
 * The model is an input source, not an authority: it returns coordinates in
 * the wrong order, outside 0-1, or as strings often enough that trusting them
 * would mean cropping to a negative rectangle. A null here simply falls back
 * to a centred crop.
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
 * The largest rectangle of TARGET_ASPECT that fits inside the image.
 *
 * Used when nothing was detected. Centred, because with no information about
 * where the garment is, the middle is the best guess.
 */
function centeredFallback(imageWidth: number, imageHeight: number): CropRect {
  const width = Math.min(imageWidth, imageHeight * TARGET_ASPECT);
  const height = width / TARGET_ASPECT;
  return {
    originX: Math.round((imageWidth - width) / 2),
    originY: Math.round((imageHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Converts a detected outline into a crop rectangle centred on the garment.
 *
 * Prefers TARGET_ASPECT but never at the garment's expense. A wide piece — a
 * scarf laid flat — cannot fit a 3:4 portrait frame without losing its ends,
 * so when the image has no room to grow, the rectangle keeps whatever shape
 * contains the whole piece.
 *
 * The shortfall is made up at display time: tiles are 3:4 with a white
 * background and scale to fit, so a wide garment shot on white gains white
 * bands above and below and looks padded rather than cropped. Doing it in the
 * file instead would need expo-image-manipulator's extent(), which is
 * web-only, so on iOS this is the whole of the mechanism.
 *
 * The steps: pad by LEEWAY, grow towards TARGET_ASPECT, shrink if that
 * overflowed the image, then restore anything the shrink took from the padded
 * box, and finally slide the result inside the bounds. Sliding rather than
 * clipping keeps the shape intact — clipping an overhanging rectangle would
 * silently change its ratio.
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

  if (box === null) return centeredFallback(imageWidth, imageHeight);

  const paddedWidth = Math.min((box.x1 - box.x0) * imageWidth * (1 + LEEWAY * 2), imageWidth);
  const paddedHeight = Math.min((box.y1 - box.y0) * imageHeight * (1 + LEEWAY * 2), imageHeight);
  const centerX = ((box.x0 + box.x1) / 2) * imageWidth;
  const centerY = ((box.y0 + box.y1) / 2) * imageHeight;

  // Grow the short side towards the target ratio.
  let width = Math.max(paddedWidth, paddedHeight * TARGET_ASPECT);
  let height = width / TARGET_ASPECT;

  // That may not fit. Shrink proportionally...
  const scale = Math.min(1, imageWidth / width, imageHeight / height);
  width *= scale;
  height *= scale;

  // ...then give back whatever the shrink took off the garment itself. This is
  // where the ratio is allowed to slip, and only ever to keep the piece whole.
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
