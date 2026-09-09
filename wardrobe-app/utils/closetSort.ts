import type { ClothingItem } from '../types/wardrobe';

/**
 * How the Closet grid orders items. 'newest' is the DB's own order
 * (`createdAt DESC`, see services/items.ts's `listItems`) — the default, and
 * the only option that needs no client-side sort at all.
 */
export type ClosetSort = 'newest' | 'price' | 'dateBought' | 'brand' | 'colour';

export const CLOSET_SORT_LABELS: Record<ClosetSort, string> = {
  newest: 'Newest first',
  price: 'Price',
  dateBought: 'Date bought',
  brand: 'Brand',
  colour: 'Colour',
};

/**
 * A blank field (an unset `purchasedAt`/`primaryColor`, or the `brand`
 * default of 'Unknown') has nothing meaningful to compare, so it sorts after
 * every item that actually has a value rather than colliding with real data
 * at an arbitrary position — 'Unknown' would otherwise alphabetize as a real
 * brand name ahead of many genuine ones.
 */
function compareBlankLast(a: string, b: string): number {
  if (a === '' && b === '') return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return a.localeCompare(b);
}

/**
 * Sorts a copy of `items` for the Closet grid. `listItems` already returns
 * `newest` order from the DB, so that case is a no-op copy rather than a
 * redundant re-sort.
 */
export function sortItems(items: readonly ClothingItem[], sort: ClosetSort): ClothingItem[] {
  const copy = [...items];
  switch (sort) {
    case 'newest':
      return copy;
    case 'price':
      return copy.sort((a, b) => a.costMinorUnits - b.costMinorUnits);
    case 'dateBought':
      // Most-recently-bought first, matching the recency-first convention
      // 'newest' already uses — a blank purchasedAt (never recorded) sorts
      // after every item with a real one, not before, the same "no value
      // beats no value" rule compareBlankLast applies for brand/colour.
      return copy.sort((a, b) => {
        if (a.purchasedAt === '' && b.purchasedAt === '') return 0;
        if (a.purchasedAt === '') return 1;
        if (b.purchasedAt === '') return -1;
        return b.purchasedAt.localeCompare(a.purchasedAt);
      });
    case 'brand':
      return copy.sort((a, b) => compareBlankLast(a.brand === 'Unknown' ? '' : a.brand, b.brand === 'Unknown' ? '' : b.brand));
    case 'colour':
      return copy.sort((a, b) => compareBlankLast(a.primaryColor, b.primaryColor));
  }
}
