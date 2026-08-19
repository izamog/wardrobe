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
 * Parses a user-typed price into whole pence.
 *
 * Returns null for anything that isn't a non-negative number so the form can
 * refuse the write rather than storing a NaN the CHECK constraint would reject
 * with a stack trace.
 */
export function parseCost(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const pounds = Number(trimmed);
  if (!Number.isFinite(pounds) || pounds < 0) return null;
  return Math.round(pounds * 100);
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
