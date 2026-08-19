import { Category, CategoryGroup } from '../types/wardrobe';
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
  'Bottom',
  'Shoes',
  'Belt',
  'Bag',
  'Scarf',
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
  Bottom: 'Bottom',
  Shoes: 'Shoes',
  Belt: 'Belt',
  Bag: 'Bag',
  Scarf: 'Scarf',
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
 * Returns the categories an item of `sourceCategory` may be compared against.
 *
 * Three rules, in the order they are applied:
 *  - Never the source category itself.
 *  - Categories in the same group compete for one slot, so they are excluded —
 *    unless one may be layered over the other, which is how a T-Shirt still
 *    gets compared with a Sweater and a Jacket with neither a Coat nor itself.
 *  - Accessory-to-accessory pairs are excluded (see ACCESSORY_ONLY_GROUPS).
 *
 * The relation is symmetric — b appears for a exactly when a appears for b.
 * Item_Compatibility depends on this, since it stores each pair once in
 * canonical id order and would otherwise be reachable from only one side.
 * Symmetry survives the layering rule because layering is checked in both
 * directions; canLayerEitherWay is what keeps that true.
 */
export function getComplementaryCategories(sourceCategory: Category): Category[] {
  const sourceGroup = CATEGORY_GROUP[sourceCategory];

  return ALL_CATEGORIES.filter((candidate) => {
    if (candidate === sourceCategory) return false;

    const candidateGroup = CATEGORY_GROUP[candidate];
    if (candidateGroup === sourceGroup) {
      return canLayerEitherWay(sourceCategory, candidate);
    }

    return !(ACCESSORY_ONLY_GROUPS.has(sourceGroup) && ACCESSORY_ONLY_GROUPS.has(candidateGroup));
  });
}
