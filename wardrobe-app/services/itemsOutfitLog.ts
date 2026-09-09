import * as Crypto from 'expo-crypto';
import { ClothingItem } from '../types/wardrobe';
import { daysBetween, isValidDateString } from '../utils/date';
import { ClothingItemRow, ITEM_COLUMNS, ItemsDatabase, parseStringArrayColumn, rowToItem } from './itemsShared';

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
 *
 * @throws if `date` isn't a well-formed YYYY-MM-DD date — a malformed value
 *   would otherwise just match zero Outfit_Logs rows and silently no-op,
 *   masking a caller bug rather than surfacing it.
 */
export async function removeOutfitLogs(db: ItemsDatabase, date: string): Promise<void> {
  if (!isValidDateString(date)) throw new Error('Invalid outfit-log date');
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
 *
 * @throws if `date` isn't a well-formed YYYY-MM-DD date — same reasoning as
 *   removeOutfitLogs.
 */
export async function replaceOutfitLog(
  db: ItemsDatabase,
  itemIds: readonly string[],
  date: string,
  id: string = Crypto.randomUUID(),
  createdAt: string = new Date().toISOString(),
): Promise<void> {
  if (!isValidDateString(date)) throw new Error('Invalid outfit-log date');
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

/** The widest recentWearDays window this app has any use for -- a year of history, generously. Rejects anything past it rather than scanning Outfit_Logs against an unbounded or absurd cutoff. */
const MAX_RECENT_WEAR_WINDOW_DAYS = 366;

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
  if (
    !isValidDateString(today) ||
    !Number.isInteger(windowDays) ||
    windowDays < 0 ||
    windowDays > MAX_RECENT_WEAR_WINDOW_DAYS
  ) {
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
