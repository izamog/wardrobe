/** @jest-environment node */
import { splitIntoWarmthBands } from '../warmthBands';

describe('splitIntoWarmthBands', () => {
  it('splits the range into three equal-width bands, in ascending order', () => {
    const { cooler, median, warmer } = splitIntoWarmthBands(1, 6);

    expect(cooler.min).toBeCloseTo(1);
    expect(cooler.max).toBeCloseTo(1 + 5 / 3);
    expect(median.min).toBeCloseTo(1 + 5 / 3);
    expect(median.max).toBeCloseTo(1 + (2 * 5) / 3);
    expect(warmer.min).toBeCloseTo(1 + (2 * 5) / 3);
    expect(warmer.max).toBeCloseTo(6);
  });

  it('centers each band at its own midpoint', () => {
    const { cooler, median, warmer } = splitIntoWarmthBands(0, 9);

    expect(cooler.center).toBeCloseTo(1.5);
    expect(median.center).toBeCloseTo(4.5);
    expect(warmer.center).toBeCloseTo(7.5);
  });

  it('collapses all three bands to the same single point when floor equals ceiling', () => {
    const { cooler, median, warmer } = splitIntoWarmthBands(5, 5);

    expect(cooler.center).toBe(5);
    expect(median.center).toBe(5);
    expect(warmer.center).toBe(5);
  });
});
