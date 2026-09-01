import * as Crypto from 'expo-crypto';
import {
  ClothingItem,
  Category,
  CompatibilityStatus,
  GarmentLength,
  HardwareColor,
  ItemColor,
  MaterialEntry,
  SleeveLength,
  Thickness,
} from '../types/wardrobe';
import { MAX_MATERIALS } from '../utils/proposals';
import { daysBetween, isValidDateString } from '../utils/date';

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
  /** Same contract as MigratableDatabase's — see services/migrations.ts. */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
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
  imageMarginBaked: number;
  category: string;
  brand: string;
  costMinorUnits: number;
  isSecondHand: number;
  purchasedAt: string;
  materials: string;
  primaryColor: string;
  secondaryColor: string;
  hardwareColor: string;
  hasBeltLoops: number;
  sleeveLength: string;
  length: string;
  thickness: string;
  denier: number;
  backless: number;
  inferredWarmth: number;
  inferredWind: number;
  wearCount: number;
  createdAt: string;
  archivedAt: string;
  isWorkAppropriate: number;
}

/**
 * Parses a JSON-string-array column (materials, Outfit_Logs.itemIds),
 * tolerating anything that isn't actually one.
 *
 * Both columns are only constrained to be TEXT, so a bad write (or a future
 * migration) could leave something else there. An unreadable list is not a
 * reason to fail the whole closet screen.
 */
function parseStringArrayColumn(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

/**
 * Decodes the materials column, tolerating both the current
 * `{material, percent}[]` shape and a plain `string[]` — every row written
 * before material percentages existed is the latter, and there is no
 * migration rewriting them (see MaterialEntry's own doc comment in
 * types/wardrobe.ts): a legacy plain-string entry decodes as
 * `{material: entry, percent: 0}`, "not recorded", the same as any other
 * item whose percentage was simply never filled in. Also tolerates anything
 * that isn't actually a well-formed array of either shape, the same
 * resilience parseStringArrayColumn gives itemIds — a bad write (or a
 * future migration) leaving something else in a TEXT column is not a
 * reason to fail the whole closet screen.
 */
function decodeMaterials(raw: string): MaterialEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: MaterialEntry[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        entries.push({ material: entry, percent: 0 });
      } else if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { material?: unknown }).material === 'string'
      ) {
        const rawPercent = (entry as { percent?: unknown }).percent;
        // Clamped and rounded rather than rejected outright, same tolerance
        // the rest of this function gives a malformed row: a corrupted or
        // out-of-range percent (NaN, negative, >100, a stray float) must not
        // reach materialAdjustment's weighted average in utils/warmth.ts,
        // but the material itself is still real data worth keeping.
        const percent =
          typeof rawPercent === 'number' && Number.isFinite(rawPercent)
            ? Math.round(Math.min(100, Math.max(0, rawPercent)))
            : 0;
        entries.push({ material: (entry as { material: string }).material, percent });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Encodes materials for storage, enforcing the at-most-MAX_MATERIALS rule at
 * the one place every write path — insertItem, updateItem, and anything
 * added later — actually goes through.
 *
 * MultiSelectField's maxSelected (components/Form.tsx) already stops the
 * picker from selecting a third material, and utils/proposals.ts already
 * caps what a spoken description can propose, but neither of those is a
 * guarantee: a bypassed or future caller — a bulk import, a bug in a form —
 * could still hand insertItem/updateItem a longer array. materials has no
 * CHECK constraint the way category or colour do (see ALL_MATERIALS' own doc
 * comment: it's a JSON TEXT column, not one a CHECK can reasonably police),
 * so this is the schema-equivalent enforcement point.
 *
 * Also normalizes each entry's percent the same way decodeMaterials clamps
 * one coming back out — a bypassed or future caller could hand this a
 * percent outside [0, 100] (or not a finite number at all) as easily as it
 * could hand it a fourth material, and an unclamped write would round-trip
 * straight back out through decodeMaterials' own clamp on the next read
 * regardless, just after having sat in the database in an invalid shape in
 * the meantime.
 */
function encodeMaterials(materials: readonly MaterialEntry[]): string {
  return JSON.stringify(
    materials.slice(0, MAX_MATERIALS).map(({ material, percent }) => ({
      material,
      percent: Number.isFinite(percent) ? Math.round(Math.min(100, Math.max(0, percent))) : 0,
    })),
  );
}

export function rowToItem(row: ClothingItemRow): ClothingItem {
  return {
    id: row.id,
    imagePath: row.imagePath,
    originalImagePath: row.originalImagePath,
    imageMarginBaked: row.imageMarginBaked === 1,
    // The CHECK constraints in migrations.ts are what make these casts safe:
    // no other value can reach the column.
    category: row.category as Category,
    brand: row.brand,
    costMinorUnits: row.costMinorUnits,
    isSecondHand: row.isSecondHand === 1,
    purchasedAt: row.purchasedAt,
    materials: decodeMaterials(row.materials),
    // Safe casts for the same reason as category: the CHECK constraints mean
    // no other value can reach these columns.
    primaryColor: row.primaryColor as ItemColor | '',
    secondaryColor: row.secondaryColor as ItemColor | '',
    hardwareColor: row.hardwareColor as HardwareColor,
    hasBeltLoops: row.hasBeltLoops === 1,
    sleeveLength: row.sleeveLength as SleeveLength,
    length: row.length as GarmentLength | '',
    thickness: row.thickness as Thickness,
    denier: row.denier,
    backless: row.backless === 1,
    inferredWarmth: row.inferredWarmth,
    inferredWind: row.inferredWind,
    wearCount: row.wearCount,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
    isWorkAppropriate: row.isWorkAppropriate === 1,
  };
}

/**
 * The caller-supplied half of a new item; the rest is defaulted or generated.
 *
 * archivedAt is excluded the same way id/wearCount/createdAt are: a new item
 * is never created pre-archived, and archiving afterwards goes through
 * archiveItems below, not a normal update.
 */
export type NewClothingItem = Omit<ClothingItem, 'id' | 'wearCount' | 'createdAt' | 'archivedAt'>;

/**
 * The fields an edit form may change. Identity, wear history, creation time
 * and archive state are not editable this way — see archiveItems/restoreItem
 * for the dedicated functions that change archivedAt.
 */
export type ItemUpdate = Partial<Omit<ClothingItem, 'id' | 'wearCount' | 'createdAt' | 'archivedAt'>>;

const ITEM_COLUMNS = `id, imagePath, originalImagePath, imageMarginBaked, category, brand, costMinorUnits, isSecondHand,
  purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength, length,
  thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt, isWorkAppropriate`;

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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      item.imagePath,
      item.originalImagePath,
      item.imageMarginBaked ? 1 : 0,
      item.category,
      item.brand,
      item.costMinorUnits,
      item.isSecondHand ? 1 : 0,
      item.purchasedAt,
      encodeMaterials(item.materials),
      item.primaryColor,
      item.secondaryColor,
      item.hardwareColor,
      item.hasBeltLoops ? 1 : 0,
      item.sleeveLength,
      item.length,
      item.thickness,
      item.denier,
      item.backless ? 1 : 0,
      item.inferredWarmth,
      item.inferredWind,
      0,
      createdAt,
      '',
      item.isWorkAppropriate ? 1 : 0,
    ],
  );
  return {
    ...item,
    id,
    wearCount: 0,
    createdAt,
    archivedAt: '',
    // Matches what encodeMaterials actually wrote above -- returning the
    // caller's untruncated array here would make the in-memory item lie
    // about what a re-fetch of the same row would report.
    materials: item.materials.slice(0, MAX_MATERIALS),
  };
}

/**
 * Lists items newest first, optionally narrowed to one category.
 *
 * `null` means "All" rather than "no category" — the Closet filter chips have
 * an All option and it would otherwise need a second function.
 *
 * Archived items are always excluded — a bulk-deleted item held in the
 * 30-day grace period (see archiveItems) has no business showing up in the
 * closet, an outfit, or a match deck. listArchivedItems is the one place
 * that sees them.
 */
export async function listItems(
  db: ItemsDatabase,
  category: Category | null = null,
): Promise<ClothingItem[]> {
  const rows = category
    ? await db.getAllAsync<ClothingItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE category = ? AND archivedAt = '' ORDER BY createdAt DESC`,
        [category],
      )
    : await db.getAllAsync<ClothingItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE archivedAt = '' ORDER BY createdAt DESC`,
        [],
      );
  return rows.map(rowToItem);
}

/**
 * Lists items in any of `categories`, newest first.
 *
 * An empty list returns nothing rather than everything — `IN ()` is not valid
 * SQLite, and "no categories" plainly means no candidates. Archived items are
 * excluded, same as listItems — the outfit generator and the match deck both
 * call through here, and neither should offer a bulk-deleted item.
 */
export async function listItemsInCategories(
  db: ItemsDatabase,
  categories: readonly Category[],
): Promise<ClothingItem[]> {
  if (categories.length === 0) return [];
  const placeholders = categories.map(() => '?').join(', ');
  const rows = await db.getAllAsync<ClothingItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ClothingItems
     WHERE category IN (${placeholders}) AND archivedAt = '' ORDER BY createdAt DESC`,
    [...categories],
  );
  return rows.map(rowToItem);
}

/** Fetches one item regardless of archive state — a direct id lookup, not a listing. */
export async function getItem(db: ItemsDatabase, id: string): Promise<ClothingItem | null> {
  const row = await db.getFirstAsync<ClothingItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE id = ?`,
    [id],
  );
  return row ? rowToItem(row) : null;
}

/**
 * Every archived item, most recently archived first — the Archive screen's
 * only data source. Unlike listItems/listItemsInCategories, this is the one
 * place archived rows are meant to surface.
 */
export async function listArchivedItems(db: ItemsDatabase): Promise<ClothingItem[]> {
  const rows = await db.getAllAsync<ClothingItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE archivedAt <> '' ORDER BY archivedAt DESC`,
    [],
  );
  return rows.map(rowToItem);
}

/**
 * Archived items whose archivedAt is at or before `cutoffIso` — candidates
 * for the permanent-deletion sweep. Oldest first, so a sweep that stops
 * partway (see purgeExpiredArchivedItems in services/itemActions.ts) clears
 * the longest-waiting items first.
 */
export async function listExpiredArchivedItems(
  db: ItemsDatabase,
  cutoffIso: string,
): Promise<ClothingItem[]> {
  const rows = await db.getAllAsync<ClothingItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE archivedAt <> '' AND archivedAt <= ? ORDER BY archivedAt ASC`,
    [cutoffIso],
  );
  return rows.map(rowToItem);
}

/**
 * Archives a batch of items in one statement — the Closet's bulk-delete
 * action. Sets archivedAt rather than removing the row: see the ClothingItem
 * doc comment for why, and purgeExpiredArchivedItems for what eventually
 * removes it for real.
 */
export async function archiveItems(
  db: ItemsDatabase,
  ids: readonly string[],
  archivedAt: string = new Date().toISOString(),
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(`UPDATE ClothingItems SET archivedAt = ? WHERE id IN (${placeholders})`, [
    archivedAt,
    ...ids,
  ]);
}

/** Pulls one item back out of the archive — the Archive screen's Restore action. */
export async function restoreItem(db: ItemsDatabase, id: string): Promise<void> {
  await db.runAsync(`UPDATE ClothingItems SET archivedAt = '' WHERE id = ?`, [id]);
}

/** Maps an editable field to its column and its SQLite representation. */
const UPDATE_ENCODERS: {
  [K in keyof ItemUpdate]-?: (value: NonNullable<ItemUpdate[K]>) => BindValue;
} = {
  imagePath: (v) => v,
  originalImagePath: (v) => v,
  imageMarginBaked: (v) => (v ? 1 : 0),
  category: (v) => v,
  brand: (v) => v,
  costMinorUnits: (v) => v,
  isSecondHand: (v) => (v ? 1 : 0),
  purchasedAt: (v) => v,
  materials: (v) => encodeMaterials(v),
  primaryColor: (v) => v,
  secondaryColor: (v) => v,
  hardwareColor: (v) => v,
  hasBeltLoops: (v) => (v ? 1 : 0),
  sleeveLength: (v) => v,
  length: (v) => v,
  thickness: (v) => v,
  denier: (v) => v,
  backless: (v) => (v ? 1 : 0),
  inferredWarmth: (v) => v,
  inferredWind: (v) => v,
  isWorkAppropriate: (v) => (v ? 1 : 0),
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

/**
 * The ids of every item worn on `date` (YYYY-MM-DD), across every outfit
 * logged that day.
 *
 * itemIds is stored as JSON text (see OutfitLog), so this parses every
 * matching row rather than querying inside the column — the same choice
 * services/items.ts already makes for the materials column.
 */
export async function listItemsWornOn(db: ItemsDatabase, date: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ itemIds: string }>(
    'SELECT itemIds FROM Outfit_Logs WHERE date = ?',
    [date],
  );
  const worn = new Set<string>();
  for (const row of rows) {
    for (const id of parseStringArrayColumn(row.itemIds)) worn.add(id);
  }
  return worn;
}

/** Inserts one Outfit_Logs row and credits each item's wearCount — the shared body of logOutfitWorn and replaceOutfitLog. Caller must already be inside a transaction. */
async function insertOutfitLog(
  db: ItemsDatabase,
  itemIds: readonly string[],
  date: string,
  id: string,
  createdAt: string,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO Outfit_Logs (id, date, itemIds, collageImageUri, createdAt) VALUES (?, ?, ?, ?, ?)',
    [id, date, JSON.stringify(itemIds), '', createdAt],
  );
  for (const itemId of itemIds) {
    await db.runAsync('UPDATE ClothingItems SET wearCount = wearCount + 1 WHERE id = ?', [itemId]);
  }
}

/** Deletes every Outfit_Logs row for `date` and un-credits each item's wearCount by one per occurrence — the shared body of removeOutfitLogs and replaceOutfitLog. Caller must already be inside a transaction. clamped at 0 (max(...,0)) rather than assuming the invariant always holds, per this codebase's defensive-programming convention. */
async function clearOutfitLogsForDate(db: ItemsDatabase, date: string): Promise<void> {
  const rows = await db.getAllAsync<{ itemIds: string }>('SELECT itemIds FROM Outfit_Logs WHERE date = ?', [date]);
  for (const row of rows) {
    for (const itemId of parseStringArrayColumn(row.itemIds)) {
      await db.runAsync('UPDATE ClothingItems SET wearCount = MAX(wearCount - 1, 0) WHERE id = ?', [itemId]);
    }
  }
  await db.runAsync('DELETE FROM Outfit_Logs WHERE date = ?', [date]);
}

/**
 * Records an outfit as worn on `date`, and credits each of its items with one
 * more wear.
 *
 * The two writes share a transaction so a crash between them can never leave
 * a logged outfit whose items' wearCount didn't move, or vice versa — the
 * exact shape sketched (but never wired up) in services/database.ts's
 * pre-Phase-5 TODO comment. wearCount is intentionally not a SQL trigger; see
 * that comment for why.
 *
 * Adds a new log row alongside any already logged for `date` rather than
 * replacing them — see listItemsWornOn's "unions items across multiple
 * outfits logged the same day" test for why that's intentional (e.g. a
 * morning outfit and a separate evening change). A UI that means "replace
 * what's shown for this single day" (Calendar's "Edit outfit") wants
 * replaceOutfitLog instead, not this function.
 */
export async function logOutfitWorn(
  db: ItemsDatabase,
  itemIds: readonly string[],
  date: string,
  id: string = Crypto.randomUUID(),
  createdAt: string = new Date().toISOString(),
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await insertOutfitLog(db, itemIds, date, id, createdAt);
  });
}

/**
 * Removes every outfit logged for `date` and un-credits each item's
 * wearCount to match — the counterpart to logOutfitWorn, for Calendar's
 * "Remove outfit". A no-op (not an error) when nothing was logged that day.
 */
export async function removeOutfitLogs(db: ItemsDatabase, date: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await clearOutfitLogsForDate(db, date);
  });
}

/**
 * Replaces whatever was logged for `date` with this single outfit, in one
 * transaction — the clear and the insert either both land or neither does.
 * What Calendar's "Edit outfit" should call: unlike logOutfitWorn, a
 * previously-logged outfit for the same day is scrubbed (and its items'
 * wearCount un-credited) rather than left stacked underneath the new one.
 */
export async function replaceOutfitLog(
  db: ItemsDatabase,
  itemIds: readonly string[],
  date: string,
  id: string = Crypto.randomUUID(),
  createdAt: string = new Date().toISOString(),
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await clearOutfitLogsForDate(db, date);
    await insertOutfitLog(db, itemIds, date, id, createdAt);
  });
}

/**
 * Looks up items by id, in no particular order — a bulk equivalent of
 * getItem for when the caller already has a list of ids (an Outfit_Logs row's
 * itemIds) rather than a category to query by.
 *
 * An empty list returns nothing rather than everything, same reasoning as
 * listItemsInCategories: `IN ()` is not valid SQLite.
 */
export async function listItemsByIds(
  db: ItemsDatabase,
  ids: readonly string[],
): Promise<ClothingItem[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<ClothingItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ClothingItems WHERE id IN (${placeholders})`,
    [...ids],
  );
  return rows.map(rowToItem);
}

/**
 * Every day in [startDate, endDate] (inclusive, YYYY-MM-DD) that has at least
 * one logged outfit, mapped to that day's most recently logged items — the
 * Calendar screen's one query for a whole grid, rather than one
 * getLatestLoggedOutfit call per cell.
 *
 * Rows are read oldest-created first, so when more than one outfit was logged
 * the same day, a later row's itemIds simply overwrites the earlier one in
 * idsByDate — the same "most recent wins" rule getLatestLoggedOutfit applies
 * per day, computed here for a whole range in one pass instead of N.
 */
export async function listLoggedOutfitsInRange(
  db: ItemsDatabase,
  startDate: string,
  endDate: string,
): Promise<Map<string, ClothingItem[]>> {
  const rows = await db.getAllAsync<{ date: string; itemIds: string }>(
    'SELECT date, itemIds FROM Outfit_Logs WHERE date BETWEEN ? AND ? ORDER BY createdAt ASC',
    [startDate, endDate],
  );

  const idsByDate = new Map<string, string[]>();
  for (const row of rows) idsByDate.set(row.date, parseStringArrayColumn(row.itemIds));

  const allIds = [...new Set([...idsByDate.values()].flat())];
  const itemById = new Map((await listItemsByIds(db, allIds)).map((item) => [item.id, item]));

  const result = new Map<string, ClothingItem[]>();
  for (const [date, ids] of idsByDate) {
    result.set(
      date,
      ids.map((id) => itemById.get(id)).filter((item): item is ClothingItem => item !== undefined),
    );
  }
  return result;
}

/**
 * The most recently logged outfit for `date`, resolved to items — or an
 * empty list if nothing has been logged that day yet.
 *
 * "Most recent" matters when more than one outfit was logged the same day
 * (an outfit changed partway through the day, say): this is what TodayScreen
 * shows pinned at the top as "what you're wearing today", so it should
 * reflect the latest decision, not the first.
 */
export async function getLatestLoggedOutfit(
  db: ItemsDatabase,
  date: string,
): Promise<ClothingItem[]> {
  const row = await db.getFirstAsync<{ itemIds: string }>(
    'SELECT itemIds FROM Outfit_Logs WHERE date = ? ORDER BY createdAt DESC LIMIT 1',
    [date],
  );
  if (!row) return [];
  return listItemsByIds(db, parseStringArrayColumn(row.itemIds));
}

/**
 * itemId -> days since it was last worn, for every item logged within the
 * last `windowDays` of `today` (both YYYY-MM-DD) -- feeds the recency
 * penalty in utils/outfitCandidatePools.ts. Absent from the map means "not
 * worn in this window", not "never worn" -- callers treat that as no
 * penalty either way (see recencyPenalty's own doc comment).
 *
 * Validates inputs and log rows upfront, rejecting malformed dates and
 * skipping future-dated logs (which would produce negative daysAgo).
 */
export async function recentWearDays(
  db: ItemsDatabase,
  today: string,
  windowDays: number = 30,
): Promise<Map<string, number>> {
  if (!isValidDateString(today) || !Number.isFinite(windowDays) || windowDays < 0) {
    throw new Error('Invalid recent-wear query');
  }

  const cutoff = daysBetween('1970-01-01', today) - windowDays; // days-since-epoch cutoff, compared the same way below
  const rows = await db.getAllAsync<{ date: string; itemIds: string }>(
    'SELECT date, itemIds FROM Outfit_Logs ORDER BY date ASC',
    [],
  );

  const result = new Map<string, number>();
  for (const row of rows) {
    if (!isValidDateString(row.date) || row.date > today) continue;
    const rowDay = daysBetween('1970-01-01', row.date);
    if (rowDay < cutoff) continue;
    const daysAgo = daysBetween(row.date, today);
    for (const itemId of parseStringArrayColumn(row.itemIds)) {
      const existing = result.get(itemId);
      if (existing === undefined || daysAgo < existing) result.set(itemId, daysAgo);
    }
  }
  return result;
}
