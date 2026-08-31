import {
  getDismatchedPairKeys,
  listItemsInCategories,
  listItemsWornOn,
  recentWearDays,
  type ItemsDatabase,
} from './items';
import { CATEGORY_GROUP, categoriesInGroup } from '../utils/categories';
import {
  DEFAULT_MAX_OUTFITS,
  generateClosestOutfits,
  generateOutfits,
  type OutfitCandidates,
  type ScoredOutfit,
} from '../utils/outfitGenerator';
import { selectDiverseOutfits } from '../utils/outfitDiversity';
import type { CategoryGroup, ClothingItem } from '../types/wardrobe';

interface TodayBounds {
  warmthFloor: number;
  warmthCeiling: number;
  windFloor: number;
  today: string;
  maxResults?: number;
}

/** What fetchTodayCandidates returns — exported so a caller can re-run generateClosestOutfits locally. */
export interface TodayCandidates {
  candidates: OutfitCandidates;
  dismatchedKeys: ReadonlySet<string>;
  /** itemId -> days since last worn, from recentWearDays — feeds rankedDiverseOutfits' recency penalty. */
  wornDaysAgo: ReadonlyMap<string, number>;
}

/**
 * Fetches every candidate pool generateOutfits/generateClosestOutfits search
 * over, already excluding today's worn bottoms — the one thing both callers
 * below need done identically, so it isn't duplicated between them.
 *
 * Returns null bottoms as the signal for "nothing to build an outfit around
 * at all", which both callers treat the same way: no point asking the search
 * to run.
 *
 * Exported (not just used internally) so a caller that wants to re-run the
 * search with different bounds — TodayScreen's troubleshooting slider is the
 * one that does — can fetch the candidate pools once and call the pure
 * generateClosestOutfits/generateOutfits directly for each slider move,
 * rather than re-querying the database on every drag.
 */
export async function fetchTodayCandidates(db: ItemsDatabase, today: string): Promise<TodayCandidates | null> {
  const [bottomsOnly, dresses, wornToday] = await Promise.all([
    // categoriesInGroup('Bottom'), not a literal ['Pants'] — Pants, Leggings
    // and Skirt all fill this slot (see CATEGORY_GROUP), so all three belong
    // in the candidate pool. A literal single-category list here previously
    // left Skirt items never offered as an outfit's bottom at all.
    listItemsInCategories(db, categoriesInGroup('Bottom')),
    // Dress is its own CategoryGroup (see the type's doc comment), but it
    // fills the same anchor role a Bottom does — see OutfitCandidates.bottoms
    // and isDressAnchor in utils/outfitGenerator.ts for where the search
    // still treats it differently (no Top required alongside it).
    listItemsInCategories(db, categoriesInGroup('Dress')),
    listItemsWornOn(db, today),
  ]);
  const allBottoms = [...bottomsOnly, ...dresses];
  const bottoms = allBottoms.filter((item) => !wornToday.has(item.id));
  if (bottoms.length === 0) return null;

  const [tops, shoes, outerwear, scarves, belts, bags, tights, dismatchedKeys, wornDaysAgo] = await Promise.all([
    listItemsInCategories(db, categoriesInGroup('Top')),
    listItemsInCategories(db, categoriesInGroup('Shoes')),
    listItemsInCategories(db, categoriesInGroup('Outerwear')),
    listItemsInCategories(db, categoriesInGroup('Scarf')),
    listItemsInCategories(db, categoriesInGroup('Belt')),
    listItemsInCategories(db, categoriesInGroup('Bag')),
    listItemsInCategories(db, categoriesInGroup('Tights')),
    getDismatchedPairKeys(db),
    recentWearDays(db, today),
  ]);

  return {
    candidates: { bottoms, tops, shoes, outerwear, scarves, belts, bags, tights },
    dismatchedKeys,
    wornDaysAgo,
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
    fetched.wornDaysAgo,
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

/** Which OutfitCandidates pool a given CategoryGroup's items search under. */
const CANDIDATE_KEY_FOR_GROUP: Record<CategoryGroup, keyof OutfitCandidates> = {
  Top: 'tops',
  Outerwear: 'outerwear',
  Dress: 'bottoms',
  Bottom: 'bottoms',
  Shoes: 'shoes',
  Belt: 'belts',
  Bag: 'bags',
  Scarf: 'scarves',
  Tights: 'tights',
};

/**
 * Up to `count` weather-appropriate outfits that all genuinely feature
 * `item` — the "Create outfit with item" button on ItemDetailsScreen.
 *
 * Doesn't reuse fetchTodayCandidates: that function's "exclude bottoms
 * logged as worn today" rule exists so Today doesn't re-suggest a repeat of
 * an already-decided outfit, and its "no unworn bottoms left" -> null
 * short-circuit is built around that same assumption — neither applies here
 * (the user explicitly asked to build around this exact item, so it should
 * never be excluded for having been worn, and needing a fallback path for
 * "the item itself is the only bottom and it's logged worn today" would be
 * extra complexity for a rule this feature doesn't want in the first place).
 *
 * The item's own category group's candidate pool is narrowed to `[item]`
 * before the search runs, forcing every complete outfit in a *required*
 * slot (Top, Shoes, Bottom/Dress) to use it. That alone doesn't force
 * inclusion for an *optional* slot (Outerwear, Scarf, Belt, Bag, Tights) —
 * the search also explores skipping an optional slot entirely, and a
 * skip-branch outfit ties on weather distance with the item-included one
 * from the same core outfit, so it can win selectDiverseOutfits' per-bottom
 * cap before the item-included version is ever reached. Filtering
 * generateClosestOutfits' full ranked list down to outfits that actually
 * contain `item` — before diversifying, not after — is what makes this
 * correct for both slot kinds without special-casing either.
 */
export async function generateOutfitsWithItem(
  db: ItemsDatabase,
  item: ClothingItem,
  params: TodayBounds,
  count: number = 4,
): Promise<ClothingItem[][]> {
  const [bottomsOnly, dresses, tops, shoes, outerwear, scarves, belts, bags, tights, dismatchedKeys] =
    await Promise.all([
      listItemsInCategories(db, categoriesInGroup('Bottom')),
      listItemsInCategories(db, categoriesInGroup('Dress')),
      listItemsInCategories(db, categoriesInGroup('Top')),
      listItemsInCategories(db, categoriesInGroup('Shoes')),
      listItemsInCategories(db, categoriesInGroup('Outerwear')),
      listItemsInCategories(db, categoriesInGroup('Scarf')),
      listItemsInCategories(db, categoriesInGroup('Belt')),
      listItemsInCategories(db, categoriesInGroup('Bag')),
      listItemsInCategories(db, categoriesInGroup('Tights')),
      getDismatchedPairKeys(db),
    ]);

  const candidates: OutfitCandidates = {
    bottoms: [...bottomsOnly, ...dresses],
    tops,
    shoes,
    outerwear,
    scarves,
    belts,
    bags,
    tights,
  };
  candidates[CANDIDATE_KEY_FOR_GROUP[CATEGORY_GROUP[item.category]]] = [item];

  const ranked = generateClosestOutfits(
    candidates,
    dismatchedKeys,
    params.warmthFloor,
    params.warmthCeiling,
    params.windFloor,
    Infinity,
  ).filter((outfit) => outfit.items.some((i) => i.id === item.id));

  return selectDiverseOutfits(ranked, count).map((outfit) => outfit.items);
}
