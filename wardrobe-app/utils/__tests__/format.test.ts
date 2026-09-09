/** @jest-environment node */
/* global describe, it, expect */
import {
  costPerWear,
  formatCost,
  formatLongDate,
  formatPurchasedAtMonth,
  parseCost,
  parsePurchasedAtMonth,
  parseScale,
  SCALE_MAX,
} from '../format';

describe('formatLongDate', () => {
  it('formats a well-formed YYYY-MM-DD date', () => {
    expect(formatLongDate('2026-08-20')).toBe('20 August 2026');
  });

  it('rejects malformed input rather than producing a nonsense heading', () => {
    expect(formatLongDate('not-a-date')).toBe('Invalid date');
    expect(formatLongDate('2026-13-01')).toBe('Invalid date'); // month 13
    expect(formatLongDate('2026-02-30')).toBe('Invalid date'); // day out of range for any month
    expect(formatLongDate('')).toBe('Invalid date');
  });
});

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

  it('rejects amounts above the £100,000 ceiling', () => {
    expect(parseCost('100000')).toBe(10_000_000);
    expect(parseCost('100000.01')).toBeNull();
    expect(parseCost('99999999999')).toBeNull();
  });
});

describe('parsePurchasedAtMonth', () => {
  it('accepts a well-formed YYYY-MM value', () => {
    expect(parsePurchasedAtMonth('2024-03')).toBe('2024-03');
    expect(parsePurchasedAtMonth('  2024-03  ')).toBe('2024-03');
  });

  it('accepts an empty string as "not recorded"', () => {
    expect(parsePurchasedAtMonth('')).toBe('');
    expect(parsePurchasedAtMonth('   ')).toBe('');
  });

  it('rejects a malformed shape', () => {
    expect(parsePurchasedAtMonth('a few years ago')).toBeNull();
    expect(parsePurchasedAtMonth('2024-13')).toBeNull();
    expect(parsePurchasedAtMonth('2024-00')).toBeNull();
    expect(parsePurchasedAtMonth('2024/03')).toBeNull();
    expect(parsePurchasedAtMonth('24-03')).toBeNull();
  });

  it('rejects a year before 1900 or after the current year', () => {
    expect(parsePurchasedAtMonth('1899-12')).toBeNull();
    expect(parsePurchasedAtMonth('1900-01')).toBe('1900-01');
    const nextYear = new Date().getFullYear() + 1;
    expect(parsePurchasedAtMonth(`${nextYear}-01`)).toBeNull();
  });
});

describe('formatPurchasedAtMonth', () => {
  it('renders a YYYY-MM value as a month name and year', () => {
    expect(formatPurchasedAtMonth('2024-03')).toBe('March 2024');
    expect(formatPurchasedAtMonth('2026-12')).toBe('December 2026');
  });

  it('passes through a legacy free-text value unchanged', () => {
    expect(formatPurchasedAtMonth('a few years ago')).toBe('a few years ago');
  });

  it('passes through an empty string unchanged', () => {
    expect(formatPurchasedAtMonth('')).toBe('');
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
    expect(parseScale(String(SCALE_MAX + 1))).toBeNull();
    expect(parseScale('99')).toBeNull();
  });

  it('rejects negatives, decimals and non-numbers', () => {
    expect(parseScale('-1')).toBeNull();
    expect(parseScale('2.5')).toBeNull();
    expect(parseScale('warm')).toBeNull();
  });
});
