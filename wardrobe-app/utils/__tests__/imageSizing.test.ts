/** @jest-environment node */
import { MAX_IMAGE_DIMENSION, resizeTargetFor } from '../imageSizing';

const MAX = MAX_IMAGE_DIMENSION;

describe('resizeTargetFor', () => {
  it('leaves a photo already within the cap alone', () => {
    // The bug this replaces: resizing unconditionally to width 1500 enlarged a
    // 600px crop, producing a bigger file with no extra detail.
    expect(resizeTargetFor(600, 600)).toBeNull();
    expect(resizeTargetFor(100, 900)).toBeNull();
  });

  it('leaves a photo sitting exactly on the cap alone', () => {
    expect(resizeTargetFor(MAX, MAX)).toBeNull();
    expect(resizeTargetFor(MAX, 100)).toBeNull();
  });

  it('caps the width of a landscape photo', () => {
    expect(resizeTargetFor(4000, 3000)).toEqual({ width: MAX });
  });

  it('caps the height of a portrait photo', () => {
    // Capping width here would leave the height above the limit.
    expect(resizeTargetFor(3000, 4000)).toEqual({ height: MAX });
  });

  it('caps one edge of a square photo one pixel over', () => {
    expect(resizeTargetFor(MAX + 1, MAX + 1)).toEqual({ width: MAX });
  });

  it('falls back to a bounded width when dimensions are unusable', () => {
    for (const [w, h] of [
      [0, 0],
      [-1, 100],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
    ]) {
      expect(resizeTargetFor(w, h)).toEqual({ width: MAX });
    }
  });

  it('honours an explicit cap', () => {
    expect(resizeTargetFor(500, 400, 300)).toEqual({ width: 300 });
    expect(resizeTargetFor(200, 200, 300)).toBeNull();
  });
});
