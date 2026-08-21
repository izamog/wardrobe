import { getDismatchedPairKeys, listItemsInCategories, listItemsWornOn, type ItemsDatabase } from './items';
import { categoriesInGroup } from '../utils/categories';
import {
  DEFAULT_MAX_OUTFITS,
  generateClosestOutfits,
  generateOutfits,
  type OutfitCandidates,
  type ScoredOutfit,
} from '../utils/outfitGenerator';
import type { ClothingItem } from '../types/wardrobe';

interface TodayBounds {
  warmthFloor: number;
  warmthCeiling: number;
  windFloor: number;
  today: string;
  maxResults?: number;
}

/**
 * Fetches every candidate pool generateOutfits/generateClosestOutfits search
 * over, already excluding today's worn bottoms — the one thing both callers
 * below need done identically, so it isn't duplicated between them.
 *
 * Returns null bottoms as the signal for "nothing to build an outfit around
 * at all", which both callers treat the same way: no point asking the search
 * to run.
 */
async function fetchTodayCandidates(
  db: ItemsDatabase,
  today: string,
): Promise<{ candidates: OutfitCandidates; dismatchedKeys: ReadonlySet<string> } | null> {
  const [allBottoms, wornToday] = await Promise.all([
    // categoriesInGroup('Bottom'), not a literal ['Pants'] — Pants and Skirt
    // both fill this slot (see CATEGORY_GROUP), so both belong in the
    // candidate pool. A literal single-category list here previously left
    // Skirt items never offered as an outfit's bottom at all.
    listItemsInCategories(db, categoriesInGroup('Bottom')),
    listItemsWornOn(db, today),
  ]);
  const bottoms = allBottoms.filter((item) => !wornToday.has(item.id));
  if (bottoms.length === 0) return null;

  const [tops, shoes, outerwear, scarves, belts, bags, dismatchedKeys] = await Promise.all([
    listItemsInCategories(db, categoriesInGroup('Top')),
    listItemsInCategories(db, categoriesInGroup('Shoes')),
    listItemsInCategories(db, categoriesInGroup('Outerwear')),
    listItemsInCategories(db, categoriesInGroup('Scarf')),
    listItemsInCategories(db, categoriesInGroup('Belt')),
    listItemsInCategories(db, categoriesInGroup('Bag')),
    getDismatchedPairKeys(db),
  ]);

  return {
    candidates: { bottoms, tops, shoes, outerwear, scarves, belts, bags },
    dismatchedKeys,
  };
}

/**
 * Generates up to maxResults outfits meeting today's weather bounds.
 *
 * Bottom is one of the candidate pools generateOutfits searches over, not a
 * pre-chosen anchor — the only Bottom-specific step left here is excluding
 * whatever was already logged as worn today (see listItemsWornOn), which is
 * about not repeating an outfit, not about the weather. Weather
 * appropriateness is entirely generateOutfits' job now.
 *
 * `today` is a parameter rather than read from the clock in here, so this
 * stays testable against a fixed date without faking system time.
 */
export async function generateTodayOutfits(
  db: ItemsDatabase,
  params: TodayBounds,
): Promise<ClothingItem[][]> {
  const fetched = await fetchTodayCandidates(db, params.today);
  if (!fetched) return [];

  return generateOutfits(
    fetched.candidates,
    fetched.dismatchedKeys,
    params.warmthFloor,
    params.warmthCeiling,
    params.windFloor,
    params.maxResults ?? DEFAULT_MAX_OUTFITS,
  );
}

/**
 * The outfits today's search space actually contains, ranked closest to the
 * weather bounds first, regardless of whether they clear them — for the
 * "nothing meets today's forecast" troubleshooting view (see TodayScreen),
 * not for recommending what to wear. See generateClosestOutfits for why this
 * doesn't just reuse generateTodayOutfits' result: that function stops the
 * moment it has enough outfits that already qualify, so it never sees the
 * near-misses this one exists to show.
 */
export async function generateClosestTodayOutfits(
  db: ItemsDatabase,
  params: TodayBounds,
): Promise<ScoredOutfit[]> {
  const fetched = await fetchTodayCandidates(db, params.today);
  if (!fetched) return [];

  return generateClosestOutfits(
    fetched.candidates,
    fetched.dismatchedKeys,
    params.warmthFloor,
    params.warmthCeiling,
    params.windFloor,
    params.maxResults ?? DEFAULT_MAX_OUTFITS,
  );
}
