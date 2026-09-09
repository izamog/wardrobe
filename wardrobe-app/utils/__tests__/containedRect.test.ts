/** @jest-environment node */
import { containedRect } from '../containedRect';

describe('containedRect', () => {
  it('fills the container exactly when the ratios match', () => {
    expect(containedRect(300, 400, 3, 4)).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });

  it('letterboxes top and bottom for an image wider than the container', () => {
    // A 2:1 image in a 1:1 box: width fills, height shrinks, centred vertically.
    expect(containedRect(200, 200, 400, 200)).toEqual({ x: 0, y: 50, width: 200, height: 100 });
  });

  it('letterboxes left and right for an image taller than the container', () => {
    // A 1:2 image in a 1:1 box: height fills, width shrinks, centred horizontally.
    expect(containedRect(200, 200, 200, 400)).toEqual({ x: 50, y: 0, width: 100, height: 200 });
  });

  it('returns a zero rect for a non-positive dimension', () => {
    const cases: [number, number, number, number][] = [
      [0, 400, 3, 4],
      [300, 0, 3, 4],
      [300, 400, 0, 4],
      [300, 400, 3, 0],
      [-1, 400, 3, 4],
    ];
    for (const dims of cases) {
      expect(containedRect(...dims)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    }
  });

  it('returns a zero rect for a non-finite dimension', () => {
    expect(containedRect(300, 400, Number.NaN, 4)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(containedRect(300, 400, Number.POSITIVE_INFINITY, 4)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});
