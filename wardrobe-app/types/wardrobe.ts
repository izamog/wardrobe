/**
 * The coarse slot a category occupies in an outfit.
 *
 * Distinct from Category because several garment types share a slot: a T-Shirt
 * and a Sweater are both Tops, which is why they are excluded from ordinary
 * pairing and admitted only through the layering rules in utils/layering.ts.
 */
export type CategoryGroup =
  | 'Top'
  | 'Bottom'
  | 'Outerwear'
  | 'Shoes'
  | 'Belt'
  | 'Bag'
  | 'Scarf';

/**
 * The garment type stored on an item.
 *
 * 'Top' and 'Outerwear' are the generic members kept from the first schema.
 * They remain valid so items created before the specific types existed still
 * load, but they carry no layering permissions — see utils/layering.ts.
 *
 * Each member here has a matching entry in the category CHECK constraint in
 * services/migrations.ts. Adding one means adding a migration.
 */
export type Category =
  | 'T-Shirt'
  | 'Shirt'
  | 'Tank'
  | 'Sweater'
  | 'Top'
  | 'Jacket'
  | 'Coat'
  | 'Outerwear'
  | 'Bottom'
  | 'Shoes'
  | 'Belt'
  | 'Bag'
  | 'Scarf';

/**
 * Metal finish of an item's hardware (buckles, zips, clasps).
 *
 * 'None' covers items with no visible hardware and is the column default, so
 * it must stay in this union even as finishes are added.
 *
 * Each member here has a matching entry in the hardwareColor CHECK constraint
 * in services/migrations.ts. Adding one means adding a migration.
 */
export type HardwareColor = 'Gold' | 'Silver' | 'None';

export type CompatibilityStatus = 'MATCH' | 'DISMATCH';

export interface ClothingItem {
  id: string;
  imageUri: string;
  category: Category;
  brand: string;
  /**
   * Price in minor currency units (pence, cents) as a whole number — 1250 is
   * £12.50. Integers because REAL cannot represent most decimal amounts
   * exactly, so totals and comparisons drift. Format for display only.
   */
  costMinorUnits: number;
  isSecondHand: boolean;
  /** Stored as a JSON array string in SQLite; parse on read, stringify on write. */
  materials: string[];
  hardwareColor: HardwareColor;
  hasBeltLoops: boolean;
  /** 0-10, enforced by a CHECK constraint. */
  inferredWarmth: number;
  /** 0-10, enforced by a CHECK constraint. */
  inferredWind: number;
  wearCount: number;
  createdAt: string;
}

export interface ItemCompatibility {
  id: string;
  itemAId: string;
  itemBId: string;
  status: CompatibilityStatus;
  createdAt: string;
}

export interface OutfitLog {
  id: string;
  /** ISO calendar date, YYYY-MM-DD, enforced by a CHECK constraint. */
  date: string;
  /** Stored as a JSON array string in SQLite; parse on read, stringify on write. */
  itemIds: string[];
  collageImageUri: string;
  createdAt: string;
}

// NOTE (Phase 2): these interfaces describe items as the app uses them, not as
// SQLite stores them — booleans are INTEGER 0/1 and the string[] fields are
// JSON text on disk. The data access layer owes both directions of that
// mapping; casting a raw row to ClothingItem would produce a value whose type
// is wrong about three of its fields.
