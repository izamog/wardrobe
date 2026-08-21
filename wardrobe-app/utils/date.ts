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
