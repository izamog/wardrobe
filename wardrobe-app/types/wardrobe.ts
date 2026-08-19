export type Category =
  | 'Top'
  | 'Bottom'
  | 'Outerwear'
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
