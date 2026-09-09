import {
  ClothingItem,
  Category,
  GarmentLength,
  HardwareColor,
  ItemColor,
  MaterialEntry,
  SleeveLength,
  Thickness,
} from '../types/wardrobe';
import { MAX_MATERIALS } from '../utils/proposals';

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
export interface ClothingItemRow {
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
export function parseStringArrayColumn(raw: string): string[] {
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
export function decodeMaterials(raw: string): MaterialEntry[] {
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
export function encodeMaterials(materials: readonly MaterialEntry[]): string {
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

export const ITEM_COLUMNS = `id, imagePath, originalImagePath, imageMarginBaked, category, brand, costMinorUnits, isSecondHand,
  purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength, length,
  thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt, isWorkAppropriate`;
