import { PantsLength, Category, CategoryGroup, GarmentLength, LeggingsLength, SkirtLength } from '../types/wardrobe';
import { canLayerEitherWay } from './layering';

// Must list every member of the Category union. Adding a category to the type
// without adding it here silently drops it from every comparison the app offers.
// Ordered by where the garment sits, because this order is the UI's order:
// the filter chips, the category picker and every complementary list follow it.
export const ALL_CATEGORIES: Category[] = [
  'T-Shirt',
  'Top',
  'Shirt',
  'Cardigan',
  'Sweater',
  'Jacket',
  'Coat',
  'Dress',
  'Pants',
  'Shorts',
  'Leggings',
  'Skirt',
  'Shoes',
  'Boots',
  'Sandals',
  'Belt',
  'Bag',
  'Scarf',
  'Tights',
];

/**
 * The outfit slot each category occupies.
 *
 * Two categories in the same group compete for one place in an outfit, so they
 * are not ordinarily paired — except where the layering rules say they can be
 * worn together, which is the whole reason this mapping exists.
 *
 * 'Outerwear' survives as a group even though it is no longer a category:
 * Jacket and Coat share one slot, and that is what the group expresses.
 *
 * Typed as a total Record, so adding a Category without classifying it is a
 * compile error rather than a silent misgrouping.
 */
export const CATEGORY_GROUP: Record<Category, CategoryGroup> = {
  'T-Shirt': 'Top',
  Top: 'Top',
  Shirt: 'Top',
  Cardigan: 'Top',
  Sweater: 'Top',
  Jacket: 'Outerwear',
  Coat: 'Outerwear',
  Dress: 'Dress',
  Pants: 'Bottom',
  Shorts: 'Bottom',
  Leggings: 'Bottom',
  Skirt: 'Bottom',
  Shoes: 'Shoes',
  Boots: 'Shoes',
  Sandals: 'Shoes',
  Belt: 'Belt',
  Bag: 'Bag',
  Scarf: 'Scarf',
  Tights: 'Tights',
};

/**
 * Groups that pair with clothing but not with each other. The app never asks
 * "does this bag go with this scarf?" — only how each relates to the garments
 * worn with it.
 */
const ACCESSORY_ONLY_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>([
  'Bag',
  'Scarf',
]);

/**
 * Groups that compete for a slot another group already fills, beyond the
 * ordinary case of a group competing with itself.
 *
 * A Dress replaces a Top and a Bottom at once, so unlike every other group it
 * conflicts with two *different* groups, not just its own — the entry here is
 * symmetric (Top and Bottom each list Dress back) so the conflict is checked
 * the same way regardless of which side getComplementaryCategories is called
 * from. Everything else has no entry, meaning "no foreign-group conflict",
 * which is the ordinary case handled by the plain group-equality check.
 */
const CONFLICTING_GROUPS: Partial<Record<CategoryGroup, ReadonlySet<CategoryGroup>>> = {
  Dress: new Set<CategoryGroup>(['Top', 'Bottom']),
  Top: new Set<CategoryGroup>(['Dress']),
  Bottom: new Set<CategoryGroup>(['Dress']),
};

/** Whether two groups compete for the same outfit slot, so a layering exception is what it takes to pair them. */
function slotsConflict(a: CategoryGroup, b: CategoryGroup): boolean {
  return a === b || (CONFLICTING_GROUPS[a]?.has(b) ?? false);
}

/**
 * Returns the categories an item of `sourceCategory` may be compared against.
 *
 * Three rules, in the order they are applied:
 *  - Never the source category itself.
 *  - Categories whose groups conflict (the same group, or a foreign group
 *    listed in CONFLICTING_GROUPS) compete for one slot, so they are excluded
 *    — unless one may be layered over the other, which is how a T-Shirt still
 *    gets compared with a Sweater, a Jacket with neither a Coat nor itself,
 *    and a Dress with a T-Shirt but not with a plain Top.
 *  - Accessory-to-accessory pairs are excluded (see ACCESSORY_ONLY_GROUPS).
 *
 * The relation is symmetric — b appears for a exactly when a appears for b.
 * Item_Compatibility depends on this, since it stores each pair once in
 * canonical id order and would otherwise be reachable from only one side.
 * Symmetry survives the layering rule because layering is checked in both
 * directions; canLayerEitherWay is what keeps that true. CONFLICTING_GROUPS is
 * kept symmetric by hand for the same reason.
 */
export function getComplementaryCategories(sourceCategory: Category): Category[] {
  const sourceGroup = CATEGORY_GROUP[sourceCategory];

  return ALL_CATEGORIES.filter((candidate) => {
    if (candidate === sourceCategory) return false;

    const candidateGroup = CATEGORY_GROUP[candidate];
    if (slotsConflict(sourceGroup, candidateGroup)) {
      return canLayerEitherWay(sourceCategory, candidate);
    }

    return !(ACCESSORY_ONLY_GROUPS.has(sourceGroup) && ACCESSORY_ONLY_GROUPS.has(candidateGroup));
  });
}

/**
 * Whether hardware colour is worth recording for this category.
 *
 * Only where it drives a decision: Phase 4 matches a belt's finish against a
 * bag's, and nothing consults the finish on a t-shirt. Asking everywhere is a
 * question with no consequence attached.
 */
export function hardwareColorApplies(category: Category): boolean {
  return category === 'Belt' || category === 'Bag';
}

/** Whether belt loops are worth recording. Pants, Shorts and Skirt can all have them, and only those make a belt wearable. */
export function beltLoopsApply(category: Category): boolean {
  return category === 'Pants' || category === 'Shorts' || category === 'Skirt';
}

/**
 * Whether sleeve length is worth recording — anything with an arm hole or a
 * bodice: Top-group and Outerwear-group garments, plus a Dress. Nothing else
 * has sleeves to have a length.
 */
export function sleeveLengthApplies(category: Category): boolean {
  const group = CATEGORY_GROUP[category];
  return group === 'Top' || group === 'Outerwear' || group === 'Dress';
}

/** Pants' own length vocabulary — see PantsLength in types/wardrobe.ts. */
export const PANTS_LENGTHS: readonly PantsLength[] = ['Short', 'Mid-length', 'Capri', 'Cropped', 'Long'];

/** Skirt's own length vocabulary — see SkirtLength in types/wardrobe.ts. */
export const SKIRT_LENGTHS: readonly SkirtLength[] = ['Mini', 'Knee-length', 'Midi', 'Maxi'];

/** Leggings' own length vocabulary — see LeggingsLength in types/wardrobe.ts. */
export const LEGGINGS_LENGTHS: readonly LeggingsLength[] = ['Short', 'Knee-length', 'Capri', 'Long'];

/**
 * Whether length is worth recording for this category, and if so, which
 * vocabulary applies — Pants and Leggings each have their own, not a shared
 * one (see the GarmentLength doc comment). Skirt and Dress share the same
 * hem-length vocabulary (Mini/Knee-length/Midi/Maxi — see LENGTH_WARMTH_
 * ADJUSTMENT's own "Skirt vocabulary" comment in utils/warmth.ts, which
 * already treats the two as equivalent for warmth/wind purposes). Empty for
 * every other category: nothing else in the wardrobe has a "length"
 * question worth asking.
 */
export function lengthOptionsFor(category: Category): readonly GarmentLength[] {
  if (category === 'Pants') return PANTS_LENGTHS;
  if (category === 'Leggings') return LEGGINGS_LENGTHS;
  if (category === 'Skirt' || category === 'Dress') return SKIRT_LENGTHS;
  return [];
}

/** Whether length is worth recording for this category at all. */
export function lengthApplies(category: Category): boolean {
  return lengthOptionsFor(category).length > 0;
}

/** Whether denier is worth recording — sheer-to-opaque legwear is the only category it describes. */
export function denierApplies(category: Category): boolean {
  return category === 'Tights';
}

/**
 * Whether thickness is worth recording.
 *
 * Excluded where a more specific warmth signal already covers the same
 * ground or the category has no meaningful "how thick is the fabric"
 * question: Tights has denier for exactly this (a separate, finer-grained
 * scale — see denierApplies and denierWarmthAdjustment in utils/warmth.ts),
 * Leggings has no such scale of its own but was asked to drop thickness
 * regardless, and Belt/Bag/the Shoes group are accessories with no fabric
 * thickness to speak of in the first place.
 */
export function thicknessApplies(category: Category): boolean {
  if (category === 'Tights' || category === 'Leggings' || category === 'Belt' || category === 'Bag') {
    return false;
  }
  return CATEGORY_GROUP[category] !== 'Shoes';
}

/**
 * Whether a material's percentage share is worth recording, as opposed to
 * just which materials are present. Accessories (Belt, Bag, the Shoes group)
 * are usually one dominant material with no meaningful blend to weight —
 * see materialAdjustment's own doc comment in utils/warmth.ts for what the
 * percentage actually drives.
 */
export function materialPercentApplies(category: Category): boolean {
  if (category === 'Belt' || category === 'Bag') return false;
  return CATEGORY_GROUP[category] !== 'Shoes';
}

/**
 * Whether "backless" is worth recording — a Top or a Dress, the two
 * categories that can actually have an open back to speak of. Drives
 * clearsBacklessRule in utils/pairs.ts once set.
 */
export function backlessApplies(category: Category): boolean {
  return category === 'Top' || category === 'Dress';
}

/**
 * Every category that fills a given outfit slot.
 *
 * The inverse of CATEGORY_GROUP. Used to turn "I need a Top-slot candidate"
 * into the concrete categories a DB query can filter on — the outfit
 * generator's Top slot spans five categories (T-Shirt, Top, Shirt, Cardigan,
 * Sweater), not one.
 */
export function categoriesInGroup(group: CategoryGroup): Category[] {
  return ALL_CATEGORIES.filter((category) => CATEGORY_GROUP[category] === group);
}
