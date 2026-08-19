import { Category } from '../types/wardrobe';

// Must list every member of the Category union. Adding a category to the type
// without adding it here silently drops it from every comparison the app offers.
export const ALL_CATEGORIES: Category[] = [
  'Top',
  'Bottom',
  'Outerwear',
  'Shoes',
  'Belt',
  'Bag',
  'Scarf',
];

/**
 * Categories that pair with clothing but not with each other. The app never
 * asks "does this bag go with this scarf?" — only how each relates to the
 * garments worn with it.
 */
const ACCESSORY_ONLY_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'Bag',
  'Scarf',
]);

/**
 * Returns the categories an item of `sourceCategory` may be compared against.
 *
 * Excludes the source category itself, so items are never rated against their
 * own kind (e.g. Trousers vs Trousers), and excludes accessory-to-accessory
 * pairs (see ACCESSORY_ONLY_CATEGORIES).
 *
 * The relation is symmetric — b appears for a exactly when a appears for b.
 * Item_Compatibility depends on this, since it stores each pair once in
 * canonical id order and would otherwise be reachable from only one side.
 */
export function getComplementaryCategories(sourceCategory: Category): Category[] {
  const sourceIsAccessory = ACCESSORY_ONLY_CATEGORIES.has(sourceCategory);

  return ALL_CATEGORIES.filter(
    (candidate) =>
      candidate !== sourceCategory &&
      !(sourceIsAccessory && ACCESSORY_ONLY_CATEGORIES.has(candidate)),
  );
}
