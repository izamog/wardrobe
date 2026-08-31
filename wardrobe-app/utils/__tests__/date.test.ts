/** @jest-environment node */
import { daysBetween, daysSince, isValidDateString, todayDateString } from '../date';

describe('isValidDateString', () => {
  it('accepts a genuine calendar date', () => {
    expect(isValidDateString('2026-08-20')).toBe(true);
  });

  it('rejects malformed or non-calendar input', () => {
    expect(isValidDateString('not-a-date')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false); // month 13
    expect(isValidDateString('2026-02-30')).toBe(false); // Feb has no 30th
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString('2026-8-20')).toBe(false); // not zero-padded
  });
});

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

describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-08-31', '2026-08-31')).toBe(0);
  });

  it('counts whole days forward', () => {
    expect(daysBetween('2026-08-25', '2026-08-31')).toBe(6);
  });

  it('counts whole days across a month boundary', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3);
  });

  it('returns a negative number when earlier is after later', () => {
    expect(daysBetween('2026-08-31', '2026-08-25')).toBe(-6);
  });
});

describe('daysSince', () => {
  it('is 0 for a timestamp less than a day old', () => {
    expect(daysSince('2026-08-20T00:00:00.000Z', new Date('2026-08-20T23:59:59.000Z'))).toBe(0);
  });

  it('rounds down rather than to the nearest day', () => {
    expect(daysSince('2026-08-20T00:00:00.000Z', new Date('2026-08-21T12:00:00.000Z'))).toBe(1);
  });

  it('counts a full 30 days as 30, not 29 or 31', () => {
    expect(daysSince('2026-07-21T00:00:00.000Z', new Date('2026-08-20T00:00:00.000Z'))).toBe(30);
  });

  it('returns 0 for an unparseable timestamp rather than NaN', () => {
    expect(daysSince('not a date', new Date('2026-08-20T00:00:00.000Z'))).toBe(0);
    expect(daysSince('', new Date('2026-08-20T00:00:00.000Z'))).toBe(0);
  });

  it('returns 0 for a non-finite `now` rather than NaN', () => {
    expect(daysSince('2026-07-21T00:00:00.000Z', new Date(Number.NaN))).toBe(0);
  });
});
