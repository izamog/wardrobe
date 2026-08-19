import * as Crypto from 'expo-crypto';
import { ClothingItem, Category, CompatibilityStatus, HardwareColor } from '../types/wardrobe';

/**
 * The slice of a database connection this module needs.
 *
 * Declared structurally, like MigratableDatabase in ./migrations, so the query
 * and mapping logic below can be exercised against any driver — the tests run
 * it on node:sqlite, which needs no native runtime.
 */
export type BindValue = string | number | null;

export interface ItemsDatabase {
  runAsync(sql: string, params: BindValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
}

/**
 * A ClothingItems row exactly as SQLite returns it.
 *
 * This is the shape the app-level ClothingItem is *not*: booleans arrive as
 * INTEGER 0/1 and materials as JSON text. Casting a row straight to
 * ClothingItem would produce a value whose type lies about three fields, so
 * every read goes through rowToItem().
 */
interface ClothingItemRow {
  id: string;
  imagePath: string;
  originalImagePath: string;
  category: string;
  brand: string;
  costMinorUnits: number;
  isSecondHand: number;
  materials: string;
  hardwareColor: string;
  hasBeltLoops: number;
  inferredWarmth: number;
  inferredWind: number;
  wearCount: number;
  createdAt: string;
}

/**
 * Parses a materials column, tolerating anything that isn't a JSON string array.
 *
 * The column is only constrained to be TEXT, so a bad write (or a future
 * migration) could leave something else there. An unreadable materials list is
 * not a reason to fail the whole closet screen.
 */
function parseMaterials(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

export function rowToItem(row: ClothingItemRow): ClothingItem {
  return {
    id: row.id,
    imagePath: row.imagePath,
    originalImagePath: row.originalImagePath,
    // The CHECK constraints in migrations.ts are what make these casts safe:
    // no other value can reach the column.
    category: row.category as Category,
    brand: row.brand,
    costMinorUnits: row.costMinorUnits,
    isSecondHand: row.isSecondHand === 1,
    materials: parseMaterials(row.materials),
    hardwareColor: row.hardwareColor as HardwareColor,
    hasBeltLoops: row.hasBeltLoops === 1,
    inferredWarmth: row.inferredWarmth,
    inferredWind: row.inferredWind,
    wearCount: row.wearCount,
    createdAt: row.createdAt,
  };
}

/** The caller-supplied half of a new item; the rest is defaulted or generated. */
export type NewClothingItem = Omit<ClothingItem, 'id' | 'wearCount' | 'createdAt'>;

/** The fields an edit form may change. Identity, wear history and creation time are not editable. */
export type ItemUpdate = Partial<Omit<ClothingItem, 'id' | 'wearCount' | 'createdAt'>>;

const ITEM_COLUMNS = `id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
  materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt`;

/**
 * Inserts an item and returns it as stored.
 *
 * `id` and `createdAt` are parameters rather than being generated inline so
 * tests can make writes deterministic. Crypto.randomUUID() is a native call
 * and only resolves on-device, so off-device callers must pass an id.
 */
export async function insertItem(
  db: ItemsDatabase,
  item: NewClothingItem,
  id: string = Crypto.randomUUID(),
  createdAt: string = new Date().toISOString(),
): Promise<ClothingItem> {
  await db.runAsync(
    `INSERT INTO ClothingItems (${ITEM_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      item.imagePath,
      item.originalImagePath,
      item.category,
      item.brand,
      item.costMinorUnits,
      item.isSecondHand ? 1 : 0,
      JSON.stringify(item.materials),
      item.hardwareColor,
      item.hasBeltLoops ? 1 : 0,
      item.inferredWarmth,
      item.inferredWind,
      0,
      createdAt,
    ],
  );
  return { ...item, id, wearCount: 0, createdAt };
}

/**
 * Lists items newest first, optionally narrowed to one category.
 *
 * `null` means "All" rather than "no category" — the Closet filter chips have
 * an All option and it would otherwise need a second function.
 */
export async function listItems(
  db: ItemsDatabase,
  category: Category | null = null,
): Promise<ClothingItem[]> {
  const rows = category
    ? await db.getAllAsync<ClothingItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE category = ? ORDER BY createdAt DESC`,
        [category],
      )
    : await db.getAllAsync<ClothingItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM ClothingItems ORDER BY createdAt DESC`,
        [],
      );
  return rows.map(rowToItem);
}

/**
 * Lists items in any of `categories`, newest first.
 *
 * An empty list returns nothing rather than everything — `IN ()` is not valid
 * SQLite, and "no categories" plainly means no candidates.
 */
export async function listItemsInCategories(
  db: ItemsDatabase,
  categories: readonly Category[],
): Promise<ClothingItem[]> {
  if (categories.length === 0) return [];
  const placeholders = categories.map(() => '?').join(', ');
  const rows = await db.getAllAsync<ClothingItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ClothingItems
     WHERE category IN (${placeholders}) ORDER BY createdAt DESC`,
    [...categories],
  );
  return rows.map(rowToItem);
}

export async function getItem(db: ItemsDatabase, id: string): Promise<ClothingItem | null> {
  const row = await db.getFirstAsync<ClothingItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE id = ?`,
    [id],
  );
  return row ? rowToItem(row) : null;
}

/** Maps an editable field to its column and its SQLite representation. */
const UPDATE_ENCODERS: {
  [K in keyof ItemUpdate]-?: (value: NonNullable<ItemUpdate[K]>) => BindValue;
} = {
  imagePath: (v) => v,
  originalImagePath: (v) => v,
  category: (v) => v,
  brand: (v) => v,
  costMinorUnits: (v) => v,
  isSecondHand: (v) => (v ? 1 : 0),
  materials: (v) => JSON.stringify(v),
  hardwareColor: (v) => v,
  hasBeltLoops: (v) => (v ? 1 : 0),
  inferredWarmth: (v) => v,
  inferredWind: (v) => v,
};

export async function updateItem(
  db: ItemsDatabase,
  id: string,
  update: ItemUpdate,
): Promise<void> {
  const assignments: string[] = [];
  const params: BindValue[] = [];

  for (const key of Object.keys(UPDATE_ENCODERS) as (keyof ItemUpdate)[]) {
    const value = update[key];
    if (value === undefined) continue;
    assignments.push(`${key} = ?`);
    // The key drives both the column name and the encoder, so a field can
    // never be written through the wrong one.
    params.push((UPDATE_ENCODERS[key] as (v: unknown) => BindValue)(value));
  }

  if (assignments.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE ClothingItems SET ${assignments.join(', ')} WHERE id = ?`, params);
}

/** Deletes an item. Its Item_Compatibility rows go with it via ON DELETE CASCADE. */
export async function deleteItem(db: ItemsDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM ClothingItems WHERE id = ?', [id]);
}

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
