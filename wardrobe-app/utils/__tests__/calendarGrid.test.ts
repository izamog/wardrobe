/** @jest-environment node */
import {
  CALENDAR_GRID_COLUMNS,
  monthGrid,
  monthKeyForDate,
  monthLabelForKey,
  monthsAround,
  weekDates,
} from '../calendarGrid';

/** Parses a YYYY-MM-DD string as a local date, matching how the grid itself builds dates. */
function parseLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

describe('weekDates', () => {
  it('returns 7 consecutive days starting Monday and ending Sunday', () => {
    const dates = weekDates('2026-08-17'); // a Monday
    expect(dates).toHaveLength(7);
    expect(parseLocal(dates[0]).getDay()).toBe(1);
    expect(parseLocal(dates[6]).getDay()).toBe(0);
    expect(dates[0]).toBe('2026-08-17');
    expect(dates[6]).toBe('2026-08-23');
  });
});

describe('monthKeyForDate', () => {
  it('extracts the YYYY-MM prefix', () => {
    expect(monthKeyForDate('2026-08-19')).toBe('2026-08');
  });
});

describe('monthLabelForKey', () => {
  it('formats a "YYYY-MM" key as "Month YYYY"', () => {
    expect(monthLabelForKey('2026-08')).toBe('August 2026');
    expect(monthLabelForKey('2026-01')).toBe('January 2026');
  });
});

describe('monthsAround', () => {
  it('returns before + after + 1 month keys, centered on the month containing today', () => {
    const months = monthsAround(new Date(2026, 7, 19), 2, 3); // August 2026
    expect(months).toHaveLength(6);
    expect(months[2]).toBe('2026-08');
  });

  it('produces consecutive calendar months with no gaps or overlaps', () => {
    const months = monthsAround(new Date(2026, 1, 10), 3, 3);
    expect(months).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
  });

  it('rolls over year boundaries in both directions', () => {
    const before = monthsAround(new Date(2026, 0, 15), 2, 0); // January 2026
    expect(before).toEqual(['2025-11', '2025-12', '2026-01']);

    const after = monthsAround(new Date(2025, 11, 15), 0, 2); // December 2025
    expect(after).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('monthGrid', () => {
  it('always returns 6 rows of 7 days, Monday to Sunday', () => {
    const grid = monthGrid('2026-08');
    expect(grid).toHaveLength(6);
    for (const week of grid) {
      expect(week).toHaveLength(CALENDAR_GRID_COLUMNS);
      expect(parseLocal(week[0].date).getDay()).toBe(1); // Monday
      expect(parseLocal(week[6].date).getDay()).toBe(0); // Sunday
    }
  });

  it('starts on the Monday of the week containing the 1st of the month', () => {
    // 2026-08-01 is a Saturday, so the grid's first row starts on 2026-07-27.
    const grid = monthGrid('2026-08');
    expect(grid[0][0].date).toBe('2026-07-27');
  });

  it('flags every day actually in the target month as inMonth, and every other day as not', () => {
    const grid = monthGrid('2026-08');
    const flat = grid.flat();
    for (const day of flat) {
      expect(day.inMonth).toBe(day.date.startsWith('2026-08'));
    }
    // The 1st and the last day of August must both be present and inMonth.
    expect(flat.find((d) => d.date === '2026-08-01')?.inMonth).toBe(true);
    expect(flat.find((d) => d.date === '2026-08-31')?.inMonth).toBe(true);
  });

  it('produces 42 consecutive days with no gaps or overlaps', () => {
    const flat = monthGrid('2026-02').flat();
    expect(flat).toHaveLength(42);
    for (let i = 1; i < flat.length; i++) {
      const diff = parseLocal(flat[i].date).getTime() - parseLocal(flat[i - 1].date).getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('covers a 6-row month (e.g. an early-starting 31-day month) without truncating', () => {
    // 2026-05-01 is a Friday: a 31-day month starting on Friday needs 6 rows
    // to fit every day (last day, the 31st, lands in row 6).
    const grid = monthGrid('2026-05');
    const flat = grid.flat();
    expect(flat.find((d) => d.date === '2026-05-31' && d.inMonth)).toBeDefined();
  });
});
