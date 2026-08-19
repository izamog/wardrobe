import { canonicalPair } from '../services/items';
import { getComplementaryCategories } from './categories';
import type { ClothingItem } from '../types/wardrobe';

export interface ItemPair {
  key: string;
  a: ClothingItem;
  b: ClothingItem;
}

export const pairKey = (x: string, y: string): string => canonicalPair(x, y).join('|');

/**
 * Every pair the Speed Matcher still has a question about.
 *
 * Two rules decide what counts: the categories must be complementary (a top
 * never pairs with another top), and the pair must not already be in
 * Item_Compatibility — without the second rule the deck never empties and the
 * same pairs come back forever.
 *
 * Pure and synchronous so the selection rule can be tested without a database;
 * the caller supplies the items and the already-rated keys.
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
      const key = pairKey(items[i].id, items[j].id);
      if (ratedKeys.has(key)) continue;
      pairs.push({ key, a: items[i], b: items[j] });
    }
  }

  return pairs;
}
