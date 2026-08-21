/** @jest-environment node */
import { todayDateString } from '../date';

describe('todayDateString', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayDateString(new Date(2026, 7, 20))).toBe('2026-08-20');
  });

  it('pads single-digit months and days', () => {
    expect(todayDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('uses local time, not UTC', () => {
    // 2026-01-01T00:30 local time is still 2025-12-31 in UTC+ zones behind it,
    // but this must report the local calendar day.
    const localMidnight = new Date(2026, 0, 1, 0, 30);
    expect(todayDateString(localMidnight)).toBe('2026-01-01');
  });
});
