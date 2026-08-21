/** @jest-environment node */
import { cropRectFor, parseDetectedBox, TARGET_ASPECT, type NormalizedBox } from '../cropGeometry';

/** How far a rectangle's shape may drift from 3:4 after integer rounding. */
const ASPECT_TOLERANCE = 0.02;

const aspectOf = (rect: { width: number; height: number }) => rect.width / rect.height;

describe('parseDetectedBox', () => {
  it('reads a well-formed box', () => {
    expect(parseDetectedBox({ x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.9 })).toEqual({
      x0: 0.1,
      y0: 0.2,
      x1: 0.6,
      y1: 0.9,
    });
  });

  it('repairs a transposed box rather than discarding it', () => {
    expect(parseDetectedBox({ x0: 0.6, y0: 0.9, x1: 0.1, y1: 0.2 })).toEqual({
      x0: 0.1,
      y0: 0.2,
      x1: 0.6,
      y1: 0.9,
    });
  });

  it('rejects coordinates outside 0-1', () => {
    expect(parseDetectedBox({ x0: -0.1, y0: 0, x1: 0.5, y1: 0.5 })).toBeNull();
    expect(parseDetectedBox({ x0: 0, y0: 0, x1: 1.4, y1: 0.5 })).toBeNull();
  });

  it('rejects a box with no area', () => {
    expect(parseDetectedBox({ x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.9 })).toBeNull();
    expect(parseDetectedBox({ x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.5 })).toBeNull();
  });

  it('rejects non-numeric and missing values', () => {
    for (const raw of [
      null,
      undefined,
      'box',
      {},
      { x0: '0.1', y0: 0.2, x1: 0.6, y1: 0.9 },
      { x0: Number.NaN, y0: 0.2, x1: 0.6, y1: 0.9 },
      { x0: 0.1, y0: 0.2, x1: 0.6 },
    ]) {
      expect(parseDetectedBox(raw)).toBeNull();
    }
  });
});

describe('cropRectFor: the shape it produces', () => {
  const cases: [string, NormalizedBox | null, number, number][] = [
    ['a centred garment', { x0: 0.3, y0: 0.2, x1: 0.7, y1: 0.8 }, 3000, 4000],
    ['a garment against the left edge', { x0: 0, y0: 0.1, x1: 0.3, y1: 0.9 }, 3000, 4000],
    ['a garment against the top', { x0: 0.2, y0: 0, x1: 0.8, y1: 0.4 }, 4000, 3000],
    ['a garment filling the frame', { x0: 0, y0: 0, x1: 1, y1: 1 }, 3000, 4000],
    ['a wide garment in a landscape photo', { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.6 }, 4000, 3000],
    ['a tiny garment', { x0: 0.48, y0: 0.48, x1: 0.52, y1: 0.52 }, 3000, 4000],
    ['nothing detected', null, 3000, 4000],
    ['nothing detected, landscape', null, 4000, 3000],
    ['a square photo', { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, 2000, 2000],
    // A box that stops well short of the real edge -- the case that used to
    // crop the waistband off a pair of shorts entirely.
    ['an under-detected box', { x0: 0.15, y0: 0.4, x1: 0.85, y1: 0.75 }, 3000, 4000],
  ];

  it.each(cases)('stays inside the image for %s', (_name, box, width, height) => {
    const rect = cropRectFor(box, width, height);
    expect(rect.originX).toBeGreaterThanOrEqual(0);
    expect(rect.originY).toBeGreaterThanOrEqual(0);
    expect(rect.originX + rect.width).toBeLessThanOrEqual(width);
    expect(rect.originY + rect.height).toBeLessThanOrEqual(height);
  });

  it.each(cases)('never ends up narrower than 3:4 for %s', (_name, box, width, height) => {
    // It may be wider, to keep a wide garment whole, but never taller and
    // thinner than the tile -- that would letterbox on the sides for no reason.
    const rect = cropRectFor(box, width, height);
    expect(aspectOf(rect)).toBeGreaterThanOrEqual(TARGET_ASPECT - ASPECT_TOLERANCE);
  });

  it.each(cases)('contains the whole detected garment for %s', (_name, box, width, height) => {
    // The property that matters: cropping is the only step that destroys
    // pixels, so nothing the detector found may fall outside the rectangle.
    if (box === null) return;
    const rect = cropRectFor(box, width, height);
    expect(rect.originX).toBeLessThanOrEqual(Math.ceil(box.x0 * width));
    expect(rect.originY).toBeLessThanOrEqual(Math.ceil(box.y0 * height));
    expect(rect.originX + rect.width).toBeGreaterThanOrEqual(Math.floor(box.x1 * width));
    expect(rect.originY + rect.height).toBeGreaterThanOrEqual(Math.floor(box.y1 * height));
  });

  it.each(cases)('produces a non-empty rectangle for %s', (_name, box, width, height) => {
    const rect = cropRectFor(box, width, height);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('cropRectFor: what it centres on', () => {
  it('centres on the garment, not on the photo', () => {
    // A piece off toward the top-left, but with enough room around it that
    // sliding the padded box into bounds (see the 'stays inside the image'
    // cases above) never has to kick in -- that shifts the crop's centre away
    // from the garment's own, a different, already-tested property.
    const box = { x0: 0.15, y0: 0.15, x1: 0.45, y1: 0.55 };
    const rect = cropRectFor(box, 4000, 4000);

    const cropCenterX = rect.originX + rect.width / 2;
    const cropCenterY = rect.originY + rect.height / 2;
    expect(cropCenterX).toBeCloseTo(((box.x0 + box.x1) / 2) * 4000, -2);
    expect(cropCenterY).toBeCloseTo(((box.y0 + box.y1) / 2) * 4000, -2);
  });

  it('includes the whole detected garment plus a safety margin', () => {
    const box = { x0: 0.3, y0: 0.3, x1: 0.6, y1: 0.7 };
    const rect = cropRectFor(box, 3000, 4000);

    expect(rect.originX).toBeLessThan(box.x0 * 3000);
    expect(rect.originY).toBeLessThan(box.y0 * 4000);
    expect(rect.originX + rect.width).toBeGreaterThan(box.x1 * 3000);
    expect(rect.originY + rect.height).toBeGreaterThan(box.y1 * 4000);
  });

  it('keeps a wide garment whole even though 3:4 will not fit it', () => {
    // A scarf laid flat cannot fit a portrait frame without losing its ends.
    // The ratio gives way, not the garment; the display layer letterboxes it
    // instead (see components/FramedImage.tsx).
    const box = { x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.55 };
    const rect = cropRectFor(box, 4000, 4000);

    expect(rect.originX).toBeLessThanOrEqual(box.x0 * 4000);
    expect(rect.originX + rect.width).toBeGreaterThanOrEqual(box.x1 * 4000);
    expect(aspectOf(rect)).toBeGreaterThan(TARGET_ASPECT);
  });

  it('grows an under-detected box towards a portrait shape rather than cropping to it exactly', () => {
    // The regression this guards: a box that stops short of the real hem or
    // waistband (here, a short, wide box for what is actually a portrait-ish
    // garment) must not produce an equally short, wide crop -- that crops the
    // missed edge away for good.
    const box = { x0: 0.15, y0: 0.4, x1: 0.85, y1: 0.75 };
    const rect = cropRectFor(box, 3000, 4000);

    expect(aspectOf(rect)).toBeCloseTo(TARGET_ASPECT, 1);
    // The extra height came from growing past the box, not just the safety pad.
    const boxHeightPx = (box.y1 - box.y0) * 4000;
    expect(rect.height).toBeGreaterThan(boxHeightPx * 1.5);
  });

  it('hits 3:4 exactly when the image has room', () => {
    const rect = cropRectFor({ x0: 0.3, y0: 0.2, x1: 0.7, y1: 0.8 }, 3000, 4000);
    expect(Math.abs(aspectOf(rect) - TARGET_ASPECT)).toBeLessThan(ASPECT_TOLERANCE);
  });

  it('returns the whole photo, untouched, when nothing was detected', () => {
    // With no information about where the garment is, cropping to some
    // assumed shape would just as likely cut into it as not -- the display
    // layer letterboxes any aspect ratio equally well.
    expect(cropRectFor(null, 3000, 4000)).toEqual({
      originX: 0,
      originY: 0,
      width: 3000,
      height: 4000,
    });
    expect(cropRectFor(null, 4000, 3000)).toEqual({
      originX: 0,
      originY: 0,
      width: 4000,
      height: 3000,
    });
  });
});

describe('cropRectFor: degenerate input', () => {
  it('returns an empty rect for an image with no size', () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-10, 100],
      [Number.NaN, 100],
    ]) {
      expect(cropRectFor(null, w, h)).toEqual({ originX: 0, originY: 0, width: 0, height: 0 });
    }
  });
});
