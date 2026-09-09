import * as Crypto from 'expo-crypto';
import { ClothingItem, Category } from '../types/wardrobe';
import {
  BindValue,
  ClothingItemRow,
  ITEM_COLUMNS,
  ItemUpdate,
  ItemsDatabase,
  NewClothingItem,
  encodeMaterials,
  rowToItem,
} from './itemsShared';
import { MAX_MATERIALS } from '../utils/proposals';

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

/**
 * Sets one or both boolean flags for a whole batch of items in one call —
 * Closet's bulk-select "Mark as second-hand" / "Mark as work appropriate".
 * A flag left out of `flags` is untouched, not reset to false.
 */
export async function setItemFlags(
  db: ItemsDatabase,
  ids: readonly string[],
  flags: { isSecondHand?: boolean; isWorkAppropriate?: boolean },
): Promise<void> {
  if (ids.length === 0) return;
  const assignments: string[] = [];
  const params: BindValue[] = [];
  if (flags.isSecondHand !== undefined) {
    assignments.push('isSecondHand = ?');
    params.push(flags.isSecondHand ? 1 : 0);
  }
  if (flags.isWorkAppropriate !== undefined) {
    assignments.push('isWorkAppropriate = ?');
    params.push(flags.isWorkAppropriate ? 1 : 0);
  }
  if (assignments.length === 0) return;

  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(`UPDATE ClothingItems SET ${assignments.join(', ')} WHERE id IN (${placeholders})`, [
    ...params,
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
