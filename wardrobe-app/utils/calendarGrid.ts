import { MONTH_NAMES } from './format';
import { todayDateString } from './date';

/** Monday of the week containing `date`, per Date#getDay (0=Sunday..6=Saturday). */
function mondayOf(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - daysSinceMonday);
  return monday;
}

/** Parses a YYYY-MM-DD string as a local date, not `new Date(string)`'s UTC reading. */
function parseDateString(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** The 7 YYYY-MM-DD dates, Monday to Sunday, of the week starting `weekStart`. */
export function weekDates(weekStart: string): string[] {
  const start = parseDateString(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return todayDateString(d);
  });
}

/**
 * "August 2026" for a "YYYY-MM" month key.
 */
export function monthLabelForKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** The "YYYY-MM" key for a YYYY-MM-DD date string. */
export function monthKeyForDate(date: string): string {
  return date.slice(0, 7);
}

/** The number of day-columns the calendar grid renders — Monday through Sunday. */
export const CALENDAR_GRID_COLUMNS = 7;

/**
 * `count` consecutive "YYYY-MM" month keys, centered so index `monthsBefore`
 * is the month containing `today` — the Calendar screen's horizontally
 * paged data source, one page per month.
 */
export function monthsAround(today: Date, monthsBefore: number, monthsAfter: number): string[] {
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed
  return Array.from({ length: monthsBefore + monthsAfter + 1 }, (_, i) => {
    const offset = i - monthsBefore;
    const d = new Date(year, month + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

/** One grid cell: a real date, and whether it actually falls within the page's own month. */
export interface MonthDay {
  date: string;
  /** False for the leading/trailing days borrowed from the adjacent month just to fill out the grid. */
  inMonth: boolean;
}

/**
 * A month page always renders exactly this many Monday-start week rows,
 * regardless of how many the month itself needs (4, 5 or 6) — a fixed row
 * count is what keeps every page the same height when flipping horizontally
 * between months; a page that grew or shrank by a row would make the swipe
 * gesture visually jump. The leading/trailing rows outside the month are
 * still real, contiguous dates (see monthGrid), just flagged `inMonth: false`
 * so the screen can render them dimmed and inert instead of a real day.
 */
const MONTH_GRID_ROWS = 6;

/**
 * `monthKey`'s ("YYYY-MM") full display grid: MONTH_GRID_ROWS Monday-start
 * weeks (rows) of CALENDAR_GRID_COLUMNS days (columns) each, starting from
 * the Monday of the week containing the 1st of the month.
 */
export function monthGrid(monthKey: string): MonthDay[][] {
  const [year, month] = monthKey.split('-').map(Number);
  const gridStart = mondayOf(new Date(year, month - 1, 1));
  return Array.from({ length: MONTH_GRID_ROWS }, (_, row) =>
    Array.from({ length: CALENDAR_GRID_COLUMNS }, (_, col) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + row * 7 + col);
      const date = todayDateString(d);
      return { date, inMonth: monthKeyForDate(date) === monthKey };
    }),
  );
}
