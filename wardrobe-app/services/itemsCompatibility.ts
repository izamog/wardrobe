import * as Crypto from 'expo-crypto';
import { CompatibilityStatus } from '../types/wardrobe';
import { ItemsDatabase } from './itemsShared';

/**
 * Orders a pair the way Item_Compatibility stores it.
 *
 * The table has CHECK (item_a_id < item_b_id), so a pair has exactly one legal
 * representation. Every writer must normalise through here or half its inserts
 * are rejected and the other half create a duplicate of an existing pair under
 * the reversed key.
 */
export function canonicalPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export async function getCompatibility(
  db: ItemsDatabase,
  itemX: string,
  itemY: string,
): Promise<CompatibilityStatus | null> {
  const [a, b] = canonicalPair(itemX, itemY);
  const row = await db.getFirstAsync<{ status: string }>(
    'SELECT status FROM Item_Compatibility WHERE item_a_id = ? AND item_b_id = ?',
    [a, b],
  );
  return row ? (row.status as CompatibilityStatus) : null;
}

/** Records a verdict for a pair, replacing any previous verdict for it. */
export async function setCompatibility(
  db: ItemsDatabase,
  itemX: string,
  itemY: string,
  status: CompatibilityStatus,
  id: string = Crypto.randomUUID(),
  createdAt: string = new Date().toISOString(),
): Promise<void> {
  const [a, b] = canonicalPair(itemX, itemY);
  await db.runAsync(
    `INSERT INTO Item_Compatibility (id, item_a_id, item_b_id, status, createdAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_a_id, item_b_id) DO UPDATE SET status = excluded.status`,
    [id, a, b, status, createdAt],
  );
}

/** Removes a pair's verdict, returning it to unrated. */
export async function clearCompatibility(
  db: ItemsDatabase,
  itemX: string,
  itemY: string,
): Promise<void> {
  const [a, b] = canonicalPair(itemX, itemY);
  await db.runAsync(
    'DELETE FROM Item_Compatibility WHERE item_a_id = ? AND item_b_id = ?',
    [a, b],
  );
}

/**
 * Every verdict involving `itemId`, keyed by the *other* item's id.
 *
 * Returned as a Map so a grid of candidates can be badged without a query per
 * tile. The CASE picks whichever column isn't the item we asked about.
 */
export async function getVerdictsFor(
  db: ItemsDatabase,
  itemId: string,
): Promise<Map<string, CompatibilityStatus>> {
  const rows = await db.getAllAsync<{ otherId: string; status: string }>(
    `SELECT CASE WHEN item_a_id = ? THEN item_b_id ELSE item_a_id END AS otherId, status
     FROM Item_Compatibility
     WHERE item_a_id = ? OR item_b_id = ?`,
    [itemId, itemId, itemId],
  );
  return new Map(rows.map((row) => [row.otherId, row.status as CompatibilityStatus]));
}

/**
 * Every pair that already has a verdict, as "a|b" keys in canonical order.
 *
 * The Speed Matcher needs to know which pairs to skip, and asking per pair
 * would be one query per candidate. One set is enough because the table only
 * ever holds canonically ordered rows.
 */
export async function listRatedPairKeys(db: ItemsDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ item_a_id: string; item_b_id: string }>(
    'SELECT item_a_id, item_b_id FROM Item_Compatibility',
    [],
  );
  return new Set(rows.map((row) => `${row.item_a_id}|${row.item_b_id}`));
}

/**
 * Every pair explicitly marked DISMATCH, as "a|b" canonical keys.
 *
 * The outfit generator's cold-start rule is the mirror image of the Speed
 * Matcher's: an unrated pair is *allowed*, so only this — not
 * listRatedPairKeys — is what excludes a pairing. A fresh wardrobe with zero
 * rows here must still be able to generate outfits.
 */
export async function getDismatchedPairKeys(db: ItemsDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ item_a_id: string; item_b_id: string }>(
    "SELECT item_a_id, item_b_id FROM Item_Compatibility WHERE status = 'DISMATCH'",
    [],
  );
  return new Set(rows.map((row) => `${row.item_a_id}|${row.item_b_id}`));
}
