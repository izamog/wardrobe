/** @jest-environment node */
import { costPerWear, formatCost, parseCost, parseScale, SCALE_MAX } from '../format';

describe('formatCost', () => {
  it('renders minor units as pounds', () => {
    expect(formatCost(1250)).toBe('£12.50');
    expect(formatCost(0)).toBe('£0.00');
    expect(formatCost(5)).toBe('£0.05');
  });
});

describe('parseCost', () => {
  it('reads pounds into whole pence', () => {
    expect(parseCost('24.99')).toBe(2499);
    expect(parseCost('7')).toBe(700);
  });

  it('treats an empty field as free rather than invalid', () => {
    expect(parseCost('')).toBe(0);
    expect(parseCost('   ')).toBe(0);
  });

  it('rejects anything that is not a non-negative number', () => {
    expect(parseCost('-1')).toBeNull();
    expect(parseCost('twelve')).toBeNull();
    expect(parseCost('1,000')).toBeNull();
  });
});

describe('costPerWear', () => {
  it('divides cost by wears', () => {
    expect(costPerWear(1000, 4)).toBe('£2.50');
  });

  it('returns null rather than dividing by zero wears', () => {
    expect(costPerWear(1000, 0)).toBeNull();
    expect(costPerWear(1000, -1)).toBeNull();
  });
});

describe('parseScale', () => {
  it('accepts every value on the scale, including the unassessed zero', () => {
    for (let value = 0; value <= SCALE_MAX; value++) {
      expect(parseScale(String(value))).toBe(value);
    }
  });

  it('treats an empty field as not assessed', () => {
    expect(parseScale('')).toBe(0);
  });

  it('rejects values past the top of the scale', () => {
    // The old column allowed up to 10; the UI must not let one back in.
    expect(parseScale(String(SCALE_MAX + 1))).toBeNull();
    expect(parseScale('10')).toBeNull();
  });

  it('rejects negatives, decimals and non-numbers', () => {
    expect(parseScale('-1')).toBeNull();
    expect(parseScale('2.5')).toBeNull();
    expect(parseScale('warm')).toBeNull();
  });
});
