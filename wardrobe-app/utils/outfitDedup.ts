import { CATEGORY_GROUP } from './categories';
import type { CategoryGroup, ClothingItem } from '../types/wardrobe';

/**
 * Dropping a bare outfit once its accessorized twin (same outfit, plus a
 * compatible bag/scarf/tights) is present and worth showing instead — see
 * dropAccessoryFreeDuplicates for the full reasoning.
 */

/**
 * The outfit-slot groups a preferred Slot ever offers (see outfitSlots.ts's
 * buildSlots) — the only categories dropAccessoryFreeDuplicates treats as
 * "just an accessory" rather than a structural part of the outfit worth
 * showing on its own, the way a with-jacket and without-jacket result both
 * are.
 */
export const PREFERRED_ACCESSORY_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>([
  'Bag',
  'Scarf',
  'Tights',
]);

/**
 * Whether `superset` is exactly `subset` plus one or more extra items, all of
 * them in a preferred-accessory group — i.e. the same outfit, just with a
 * bag/scarf/tights added. Order-independent; compares by item id.
 */
function isAccessorySuperset(subset: readonly ClothingItem[], superset: readonly ClothingItem[]): boolean {
  if (superset.length <= subset.length) return false;
  const supersetIds = new Set(superset.map((item) => item.id));
  if (!subset.every((item) => supersetIds.has(item.id))) return false;
  const subsetIds = new Set(subset.map((item) => item.id));
  const extra = superset.filter((item) => !subsetIds.has(item.id));
  return extra.every((item) => PREFERRED_ACCESSORY_GROUPS.has(CATEGORY_GROUP[item.category]));
}

/**
 * The non-accessory items of an outfit, as a stable, order-independent key.
 * isAccessorySuperset can only ever hold between two outfits that share this
 * key: its own "extra items must all be accessory-group" check forces every
 * non-accessory item on either side to appear on both, which forces the two
 * outfits' non-accessory item sets to be exactly equal. That's what makes
 * bucketing by this key in dropAccessoryFreeDuplicates below safe — it's a
 * partition consistent with the pairwise check, not just a hint.
 */
function coreKey(items: readonly ClothingItem[]): string {
  return items
    .filter((item) => !PREFERRED_ACCESSORY_GROUPS.has(CATEGORY_GROUP[item.category]))
    .map((item) => item.id)
    .sort()
    .join('+');
}

/**
 * Drops an outfit whenever another one in the same result set is exactly the
 * same outfit plus a compatible accessory (see isAccessorySuperset) and
 * `isBetterOrEqual` says that accessorized version belongs in the results —
 * "always add as many accessories as possible" (bag, scarf, tights) means the
 * bare version is never itself worth showing once its accessorized twin is.
 * `isBetterOrEqual` lets generateClosestOutfits keep a bare outfit that meets
 * target alongside an accessorized twin that doesn't — the near-miss is the
 * more useful of the two there — while generateOutfits, whose results are
 * all already valid, can just always prefer the accessorized one.
 *
 * Bucketed by coreKey rather than comparing every outfit against every other
 * one: generateClosestOutfits' search is deliberately uncapped (see its own
 * doc comment), so `outfits` can run into the tens or hundreds of thousands
 * of raw combinations on a well-stocked closet — an all-pairs `some()` over
 * that many outfits is O(n²) and was the actual reason the troubleshoot
 * sliders could take minutes, not the search itself. Since a match can only
 * ever occur within the same coreKey bucket (see that function's own doc
 * comment) and a bucket only ever holds the handful of bag/scarf/tights
 * combinations one core outfit can produce, this does the identical
 * comparisons, just without the outfits that can never match each other.
 */
export function dropAccessoryFreeDuplicates<T extends { items: readonly ClothingItem[] }>(
  outfits: readonly T[],
  isBetterOrEqual: (candidate: T) => boolean,
): T[] {
  const byCoreKey = new Map<string, T[]>();
  for (const outfit of outfits) {
    const key = coreKey(outfit.items);
    const bucket = byCoreKey.get(key);
    if (bucket) bucket.push(outfit);
    else byCoreKey.set(key, [outfit]);
  }

  return outfits.filter((outfit) => {
    const bucket = byCoreKey.get(coreKey(outfit.items))!;
    return !bucket.some(
      (other) => other !== outfit && isBetterOrEqual(other) && isAccessorySuperset(outfit.items, other.items),
    );
  });
}

/**
 * Drops any outfit that is an exact duplicate (same items, any order) of one
 * already kept — keeping the first occurrence, so a caller that has already
 * sorted by rank keeps its best-ranked copy.
 *
 * Needed once two different slots can reach the identical final item set:
 * with a Dress anchor, a T-Shirt can be chosen either through the (optional
 * for a Dress) main Top slot or through Base Layer with Top skipped — both
 * land on the exact same [Dress, T-Shirt, ...] outfit. Without this, the
 * same outfit could occupy two slots in one result list for no real
 * variety. dropAccessoryFreeDuplicates only catches an accessorized outfit
 * next to its bare twin — a different kind of near-duplicate — so this runs
 * separately rather than folding into it.
 */
export function dropExactDuplicates<T extends { items: readonly ClothingItem[] }>(outfits: readonly T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const outfit of outfits) {
    const key = [...outfit.items]
      .map((item) => item.id)
      .sort()
      .join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(outfit);
  }
  return kept;
}
