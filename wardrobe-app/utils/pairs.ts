import { canonicalPair } from '../services/items';
import { getComplementaryCategories, hardwareColorApplies } from './categories';
import { hardwareColorsCompatible } from './hardware';
import type { ClothingItem } from '../types/wardrobe';

export interface ItemPair {
  key: string;
  a: ClothingItem;
  b: ClothingItem;
}

export const pairKey = (x: string, y: string): string => canonicalPair(x, y).join('|');

/**
 * A belt is only wearable against a pair of Pants that has belt loops. Pants
 * without loops cannot wear a belt at all, so pairing one is never a
 * question worth asking.
 */
function clearsBeltLoopRule(a: ClothingItem, b: ClothingItem): boolean {
  const pants = a.category === 'Pants' ? a : b.category === 'Pants' ? b : null;
  const belt = a.category === 'Belt' ? a : b.category === 'Belt' ? b : null;
  return !(pants && belt && !pants.hasBeltLoops);
}

/**
 * Where both items carry a hardware finish (only Belt and Bag do, per
 * hardwareColorApplies), the finishes must read as compatible.
 */
function clearsHardwareRule(a: ClothingItem, b: ClothingItem): boolean {
  if (!hardwareColorApplies(a.category) || !hardwareColorApplies(b.category)) return true;
  return hardwareColorsCompatible(a.hardwareColor, b.hardwareColor);
}

/**
 * Whether two items are allowed to appear together as a candidate pair, on
 * top of getComplementaryCategories' category-slot rule.
 */
export function isCompatibleCandidate(a: ClothingItem, b: ClothingItem): boolean {
  return clearsBeltLoopRule(a, b) && clearsHardwareRule(a, b);
}

/**
 * Every pair the Speed Matcher still has a question about.
 *
 * Three rules decide what counts: the categories must be complementary (a top
 * never pairs with another top), the pair must clear isCompatibleCandidate
 * (belt loops, hardware finish), and the pair must not already be in
 * Item_Compatibility — without the last rule the deck never empties and the
 * same pairs come back forever.
 *
 * Pure and synchronous so the selection rule can be tested without a database;
 * the caller supplies the items and the already-rated keys.
 *
 * O(n^2) in wardrobe size, which is the size of the answer — every unrated
 * cross-category pair is one card in the deck. Sized for a personal wardrobe of
 * hundreds of items; a closet large enough for that to hurt needs the deck
 * sampled or paged rather than this made faster.
 */
export function buildUnratedPairs(
  items: readonly ClothingItem[],
  ratedKeys: ReadonlySet<string>,
): ItemPair[] {
  const pairs: ItemPair[] = [];

  for (let i = 0; i < items.length; i++) {
    const complementary = new Set(getComplementaryCategories(items[i].category));
    // Start at i + 1: each unordered pair should be offered once, not twice.
    for (let j = i + 1; j < items.length; j++) {
      if (!complementary.has(items[j].category)) continue;
      if (!isCompatibleCandidate(items[i], items[j])) continue;
      const key = pairKey(items[i].id, items[j].id);
      if (ratedKeys.has(key)) continue;
      pairs.push({ key, a: items[i], b: items[j] });
    }
  }

  return pairs;
}
