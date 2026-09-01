import { isValidDateString } from './date';

/**
 * Formats a minor-unit amount as pounds.
 *
 * Costs are stored as whole pence (see ClothingItem.costMinorUnits), so display
 * is the only place a decimal point exists.
 */
export function formatCost(minorUnits: number): string {
  return `£${(minorUnits / 100).toFixed(2)}`;
}

/**
 * £100,000. Above this a typed or spoken price is almost certainly a mistake
 * (a misplaced digit, a misheard year or phone number) rather than a real
 * one. Shared by parseCost (typed) and utils/proposals.ts (spoken) so both
 * entry paths agree on the same ceiling.
 */
export const MAX_COST_MINOR_UNITS = 10_000_000;

/**
 * Parses a user-typed price into whole pence.
 *
 * Returns null for anything that isn't a non-negative number, or is above
 * MAX_COST_MINOR_UNITS, so the form can refuse the write rather than storing
 * a value the CHECK constraint would reject with a stack trace (or one that
 * is technically valid but not a real price).
 */
export function parseCost(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const pounds = Number(trimmed);
  if (!Number.isFinite(pounds) || pounds < 0) return null;
  const minorUnits = Math.round(pounds * 100);
  if (minorUnits > MAX_COST_MINOR_UNITS) return null;
  return minorUnits;
}

/** Calendar month names, January first — index 0 is January, matching Date#getMonth(). */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * "20 August 2026" from a YYYY-MM-DD string — the Calendar and Log Outfit
 * screens' shared date heading.
 *
 * Callers that navigate to a screen using this (LogOutfitScreen) are
 * expected to validate the date at the screen boundary with
 * isValidDateString (utils/date.ts) before ever reaching a query, a write,
 * or this formatter — this only guards the display itself against a
 * nonsense "NaN NaN NaN" heading if that boundary is ever missed.
 */
export function formatLongDate(date: string): string {
  if (!isValidDateString(date)) return 'Invalid date';
  const [yearStr, monthStr, dayStr] = date.split('-');
  return `${Number(dayStr)} ${MONTH_NAMES[Number(monthStr) - 1]} ${yearStr}`;
}

/**
 * purchasedAt's storage shape: "YYYY-MM", picked from a month/year picker
 * rather than typed. Kept as plain TEXT in the schema (see migrations.ts) —
 * this is a format the app enforces on write, not a CHECK constraint, so a
 * legacy free-text value from before the picker existed still displays (see
 * formatPurchasedAtMonth) rather than being silently discarded.
 */
const PURCHASED_AT_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Validates a "YYYY-MM" value before it's stored as purchasedAt.
 *
 * Rejects a year outside [1900, this year] — a garment cannot have been
 * bought before the calendar existed for practical purposes, nor in a month
 * that hasn't happened yet. An empty string is accepted as "not recorded".
 */
export function parsePurchasedAtMonth(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  const match = PURCHASED_AT_PATTERN.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1900 || year > new Date().getFullYear()) return null;
  return trimmed;
}

/**
 * Renders a stored purchasedAt for display: "March 2024" for a "YYYY-MM"
 * value, or the value itself unchanged for a legacy free-text entry written
 * before the month picker existed (see PURCHASED_AT_PATTERN) — never
 * discarded just because it doesn't match the current shape.
 */
export function formatPurchasedAtMonth(value: string): string {
  const match = PURCHASED_AT_PATTERN.exec(value);
  if (!match) return value;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * Cost per wear, or null when the item has never been worn.
 *
 * Dividing by a zero wearCount is the caller's real problem here: the answer is
 * not "infinity", it's "not yet worn", and only the caller can render that.
 */
export function costPerWear(costMinorUnits: number, wearCount: number): string | null {
  if (wearCount <= 0) return null;
  return formatCost(Math.round(costMinorUnits / wearCount));
}

/**
 * Highest value on the warmth and windproof scales.
 *
 * 0-10, matching the thermal targets Phase 5 computes from the forecast: an
 * outfit qualifies when its pieces' scores sum to at least the target, so both
 * sides of that comparison have to share a scale. Mirrored by a CHECK
 * constraint in services/migrations.ts.
 */
export const SCALE_MAX = 10;

/**
 * Parses a typed warmth or windproof value.
 *
 * Returns null for anything outside 0-SCALE_MAX or non-integer, so the form
 * can refuse the write rather than handing the CHECK constraint a value it
 * will reject with a stack trace. An empty field is 0, not an error: these
 * are meant to be left alone until the app fills them in.
 */
export function parseScale(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0 || value > SCALE_MAX) return null;
  return value;
}

/** Denier's own valid range — matches the CHECK constraint in services/migrations.ts. */
export const DENIER_MIN = 5;
export const DENIER_MAX = 270;

/**
 * Parses a typed denier value, the same shape parseScale uses for
 * warmth/windproof: null for anything outside the valid range or
 * non-integer, so a form can refuse the write rather than handing the CHECK
 * constraint a value it will reject with a stack trace. An empty field is 0
 * (not recorded), not an error — see denier's own doc comment in
 * types/wardrobe.ts.
 */
export function parseDenier(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < DENIER_MIN || value > DENIER_MAX) return null;
  return value;
}
