/**
 * The coarse slot a category occupies in an outfit.
 *
 * Distinct from Category because several garment types share a slot: a T-Shirt
 * and a Sweater are both Tops, which is why they are excluded from ordinary
 * pairing and admitted only through the layering rules in utils/layering.ts.
 *
 * 'Dress' is its own group rather than folded into 'Top' or 'Bottom': a dress
 * fills both slots at once, so it has to conflict with both by default rather
 * than compete only within one of them. See CONFLICTING_GROUPS in
 * utils/categories.ts, which is what encodes that.
 */
export type CategoryGroup =
  | 'Top'
  | 'Bottom'
  | 'Outerwear'
  | 'Shoes'
  | 'Belt'
  | 'Bag'
  | 'Scarf'
  | 'Dress';

/**
 * The garment type stored on an item.
 *
 * 'Top' covers basic upper-body garments that are not one of the more specific
 * types — vests, camisoles, tanks, plain jersey tops. It layers like a base
 * layer, which is what distinguishes it from 'T-Shirt' only by cut.
 *
 * 'Dress' replaces a Top and a Bottom at once rather than sitting in either
 * slot: it may be layered under a Cardigan, Sweater, Jacket or Coat, and over
 * a T-Shirt or Shirt, but never paired with a plain Top or any Bottom — see
 * utils/layering.ts for the layer pairs and utils/categories.ts for the
 * conflict rule.
 *
 * 'Pants' and 'Skirt' are the two Bottom-group categories — 'Pants' covers
 * trousers, jeans and shorts (anything below the waist that isn't a skirt).
 * They share the 'Bottom' CategoryGroup (see CATEGORY_GROUP in
 * utils/categories.ts), which is the "Bottoms" umbrella: two sibling
 * categories competing for the same outfit slot, the same relationship
 * 'Shoes' and 'Sandals' already have.
 *
 * Each member here has a matching entry in the category CHECK constraint in
 * services/migrations.ts. Adding one means adding a migration.
 */
export type Category =
  | 'T-Shirt'
  | 'Top'
  | 'Shirt'
  | 'Cardigan'
  | 'Sweater'
  | 'Jacket'
  | 'Coat'
  | 'Dress'
  | 'Pants'
  | 'Skirt'
  | 'Shoes'
  | 'Sandals'
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
export type HardwareColor = 'Gold' | 'Silver' | 'Brass' | 'Black' | 'None';

/**
 * The colour of the fabric itself.
 *
 * Distinct from HardwareColor, which is the finish on a buckle or clasp — an
 * item can be a Brown belt with Gold hardware.
 *
 * Each member has a matching entry in the colour CHECK constraints in
 * services/migrations.ts. Adding one means adding a migration.
 */
export type ItemColor =
  | 'Black'
  | 'Grey'
  | 'White'
  | 'Cream'
  | 'Beige'
  | 'Tan'
  | 'Brown'
  | 'Burgundy'
  | 'Red'
  | 'Pink'
  | 'Orange'
  | 'Yellow'
  | 'Olive'
  | 'Green'
  | 'Teal'
  | 'Blue'
  | 'Navy'
  | 'Purple'
  | 'Gold'
  | 'Silver'
  | 'Multi';

/**
 * How much of the arm a garment covers.
 *
 * A category alone conflates two very different coverage levels — 'Top' is
 * documented to mean anything from a sleeveless tank to a loose long-sleeve
 * jersey top, and those two are not close to equally warm or wind-resistant.
 * This is what utils/warmth.ts actually needs and the category can't supply
 * on its own. 'Short' is the neutral middle value: it contributes no
 * adjustment, which is also why it's the migration default — existing items
 * keep the estimate they already had rather than silently dropping when this
 * column was added.
 *
 * Each member here has a matching entry in the sleeveLength CHECK constraint
 * in services/migrations.ts. Adding one means adding a migration.
 */
export type SleeveLength = 'Sleeveless' | 'Short' | 'Long';

/**
 * How long a pair of trousers/shorts is. Skirt uses a different vocabulary
 * entirely (SkirtLength) — the two categories don't share a "length" concept
 * the way every Top-group category shares one "sleeve length" concept, so
 * this isn't a single flat union the way SleeveLength is.
 *
 * Each member here has a matching entry in the length CHECK constraint in
 * services/migrations.ts. Adding one means adding a migration.
 */
export type PantsLength = 'Short' | 'Mid-length' | 'Capri' | 'Cropped' | 'Long';

/**
 * How long a skirt is. See PantsLength for why this is a separate union
 * rather than sharing one with it.
 *
 * Each member here has a matching entry in the length CHECK constraint in
 * services/migrations.ts. Adding one means adding a migration.
 */
export type SkirtLength = 'Mini' | 'Knee-length' | 'Midi' | 'Maxi';

export type GarmentLength = PantsLength | SkirtLength;

export type CompatibilityStatus = 'MATCH' | 'DISMATCH';

export interface ClothingItem {
  id: string;
  /**
   * The photo to display, as a path relative to the app's document directory
   * (e.g. `items/<id>.jpg`), or '' when the item has no photo.
   *
   * Relative, never absolute: iOS changes the app container's UUID on
   * reinstall and on some updates, so a stored absolute file:// URI becomes a
   * dead link and the photo silently disappears. Resolve it through
   * utils/imagePaths.ts at render time.
   */
  imagePath: string;
  /**
   * The unprocessed photo, same relative-path rules.
   *
   * Equal to imagePath when no background-removal server is configured, or
   * when a cutout attempt failed; kept separately so a future re-run can be
   * applied to an already-populated wardrobe without re-photographing every
   * item. See services/backgroundRemoval.ts and services/itemActions.ts.
   */
  originalImagePath: string;
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
  /**
   * The garment's main colour, or '' when not recorded.
   *
   * Stored as two columns rather than a list because the "at most two" rule is
   * then the schema's job, not the app's, and because Phase 5 filters on
   * colour — a JSON array would not be indexable.
   */
  primaryColor: ItemColor | '';
  /** A second colour, or ''. Never set without a primary, never equal to it, never alongside 'Multi'. */
  secondaryColor: ItemColor | '';
  hardwareColor: HardwareColor;
  hasBeltLoops: boolean;
  /**
   * Only meaningful where sleeveLengthApplies(category) — see
   * utils/categories.ts. 'Short' elsewhere, same as the migration default.
   */
  sleeveLength: SleeveLength;
  /**
   * How long a Pants or Skirt item is, or '' when not recorded or not
   * applicable — see lengthApplies in utils/categories.ts. Unlike
   * sleeveLength there's no shared neutral value across categories (Pants
   * and Skirt use entirely different vocabularies), so this follows
   * primaryColor's convention instead: an empty string is a real, honest
   * "not yet known" rather than a guessed default.
   */
  length: GarmentLength | '';
  /**
   * How warm the garment is, 0-10.
   *
   * Generated by the app from Phase 3 onwards, not asked of the user, and left
   * at 0 until then. Shares its scale with the thermal targets Phase 5 derives
   * from the forecast. Enforced by a CHECK constraint; see SCALE_MAX in
   * utils/format.ts.
   */
  inferredWarmth: number;
  /** How windproof the garment is, on the same 0-10 scale. */
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
