/**
 * Today's date as YYYY-MM-DD, in local time.
 *
 * Deliberately not `Date#toISOString().slice(0, 10)`, which reads UTC — near
 * midnight in most timezones that names the wrong day, and Outfit_Logs.date
 * (and the "worn today" check the outfit generator relies on) needs the
 * user's actual calendar day, not UTC's.
 */
export function todayDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const YYYY_MM_DD = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Whether `date` is a genuine calendar date in YYYY-MM-DD form — the same
 * shape Outfit_Logs.date's CHECK constraint enforces (see
 * services/migrations.ts), checked here so a bad value can be rejected
 * before it ever reaches a query or a write, not just before it's displayed.
 *
 * The regex alone accepts a day up to 31 in every month; the round-trip
 * through Date catches a day that's in-range for the regex but doesn't exist
 * for that specific month (e.g. "2026-02-30").
 */
export function isValidDateString(date: string): boolean {
  const match = YYYY_MM_DD.exec(date);
  if (!match) return false;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const roundTrip = new Date(year, month - 1, day);
  return roundTrip.getFullYear() === year && roundTrip.getMonth() === month - 1 && roundTrip.getDate() === day;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days from `earlier` to `later`, both YYYY-MM-DD. Local-time Date
 * construction (year, month-1, day), the same approach isValidDateString
 * uses for its round-trip check -- not Date.parse/daysSince's ISO-timestamp
 * arithmetic, which reads UTC and would drift by a day near local midnight
 * against dates this app writes in local time (see todayDateString).
 */
export function daysBetween(earlier: string, later: string): number {
  const [ey, em, ed] = earlier.split('-').map(Number);
  const [ly, lm, ld] = later.split('-').map(Number);
  const earlierMs = new Date(ey, em - 1, ed).getTime();
  const laterMs = new Date(ly, lm - 1, ld).getTime();
  return Math.round((laterMs - earlierMs) / MS_PER_DAY);
}

/**
 * Whole days elapsed from an ISO timestamp to `now`, rounded down.
 *
 * Used by the Archive screen to show "N days left" against
 * ARCHIVE_RETENTION_DAYS (services/itemActions.ts) — floor, not round, so the
 * count only ticks down once a full day has actually passed rather than as
 * soon as it's more than half elapsed.
 *
 * Returns 0 for an unparseable `fromIso` (or a non-finite `now`) rather than
 * NaN — every caller here only ever passes archivedAt, which is always
 * either '' (never reaches this function — see ArchiveScreen) or a value
 * this module itself wrote, but treating a malformed timestamp as "just now"
 * is still the honest fallback: it's the reading that keeps a downstream
 * "days left" display from silently going NaN.
 */
export function daysSince(fromIso: string, now: Date = new Date()): number {
  const from = Date.parse(fromIso);
  const to = now.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.floor((to - from) / MS_PER_DAY);
}
