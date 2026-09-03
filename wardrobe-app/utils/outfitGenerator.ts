import { sumWarmth, sumWind, meetsRegionFloors, distanceFromBounds } from './outfitScoring';
import {
  bottomCandidatesFor,
  buildSlots,
  floorAwareCandidates,
  skipsBeforeCandidates,
  tryEachCandidate,
  SCARF_PREFERRED_WARMTH_FLOOR,
  type OutfitCandidates,
  type Slot,
} from './outfitSlots';
import { dropAccessoryFreeDuplicates, dropExactDuplicates, PREFERRED_ACCESSORY_GROUPS } from './outfitDedup';
import { CATEGORY_GROUP } from './categories';
import type { ClothingItem } from '../types/wardrobe';

/**
 * Building complete outfits that meet today's weather bounds, from
 * candidates already fetched and category-filtered per slot.
 *
 * Pure and synchronous — no DB here. services/outfitGenerator.ts owns
 * fetching each slot's candidates; this file only searches the combinations.
 * The supporting pieces live alongside it: outfitSlots.ts turns a candidate
 * pool and an anchor into the ordered list of slots a search walks,
 * outfitScoring.ts turns a set of chosen items into warmth/wind totals and
 * per-region checks, and outfitDedup.ts drops a bare outfit once its
 * accessorized twin is present. This file is just the two searches
 * themselves (generateOutfits, generateClosestOutfits) built on top of them.
 *
 * Bottom is a slot like any other, not a fixed input chosen ahead of time.
 * It used to be picked separately, by recency, before this search ever ran —
 * which meant no amount of ranking logic downstream could make it
 * weather-appropriate, because it was never weather-checked at all. Folding
 * it into the same lean-first, ceiling-checked search as Top and Shoes is
 * what actually fixes that: recency survives only as an emergent tie-break
 * (candidates already arrive newest-first from the DB, and
 * floorAwareCandidates' underlying rankWithFairTiebreak sort is stable), not
 * as a rule that could override the weather.
 */

export type { OutfitCandidates } from './outfitSlots';
export { MAX_SLOT_CANDIDATES, SCARF_PREFERRED_WARMTH_FLOOR } from './outfitSlots';
export { sumWarmth, sumWind } from './outfitScoring';

/** How many outfits generateOutfits returns by default. */
export const DEFAULT_MAX_OUTFITS = 3;

/** Dedupes generateOutfits' raw results (see outfitDedup.ts's dropAccessoryFreeDuplicates) and trims to maxResults. */
function finalizeOutfits(results: readonly ClothingItem[][], maxResults: number): ClothingItem[][] {
  return dropAccessoryFreeDuplicates(
    dropExactDuplicates(results.map((items) => ({ items }))),
    () => true,
  )
    .map((outfit) => outfit.items)
    .slice(0, maxResults);
}

/**
 * Builds up to `maxResults` complete outfits, each with a summed, weighted
 * warmth between `warmthFloor` and `warmthCeiling` (inclusive) and a summed,
 * weighted wind resistance at or above `windFloor`.
 *
 * The Bottom is chosen inside this same search, lean-first like every other
 * slot — see the module doc comment for why that's the fix for weather
 * appropriateness rather than a separate anchor step. Warmth is monotonic
 * non-decreasing as items are added (every score and weight is >= 0), so a
 * branch that already exceeds the ceiling is pruned immediately rather than
 * explored to a leaf that could only ever still exceed it.
 *
 * Depth-first over each Bottom's slots in buildSlots' order. An optional
 * slot tries being skipped before any candidate, biasing results toward the
 * leanest outfit that still clears the floor — later results in the same
 * call add outerwear or a bag on top of that. A required slot with no
 * compatible candidate kills that branch outright, which is how "no bottoms
 * without a DISMATCHed belt" or "nothing warm enough" correctly yields no
 * outfits rather than a wrong one.
 */
export function generateOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  maxResults: number = DEFAULT_MAX_OUTFITS,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[][] {
  const needsScarf = warmthFloor >= SCARF_PREFERRED_WARMTH_FLOOR;
  const results: ClothingItem[][] = [];
  const chosen: ClothingItem[] = [];

  // A generous multiple of maxResults, not maxResults itself: a preferred
  // slot's bare and accessorized twins can land in either order depending on
  // dismatches further down, so the search needs enough headroom for
  // dropAccessoryFreeDuplicates to have real alternatives to dedupe from
  // before the final slice down to maxResults.
  const searchBudget = Math.max(maxResults * 4, 20);

  function exceedsCeiling(): boolean {
    return sumWarmth(chosen) > warmthCeiling;
  }

  function meetsFloors(): boolean {
    return (
      sumWarmth(chosen) >= warmthFloor && sumWind(chosen) >= windFloor && meetsRegionFloors(chosen, warmthFloor)
    );
  }

  // Explores slots depth-first, pushing each complete outfit that clears
  // every floor into `results`, until the search budget above is spent.
  function searchSlots(slots: Slot[], slotIndex: number): void {
    if (results.length >= searchBudget) return;

    if (slotIndex === slots.length) {
      if (meetsFloors()) results.push([...chosen]);
      return;
    }

    const slot = slots[slotIndex];
    // A plain optional slot tries being skipped before any candidate (leanest
    // outfit first); a preferred one tries every candidate before the skip
    // branch, so an accessory is favoured over going without it — see the
    // Slot.preferred doc comment (outfitSlots.ts) and dropAccessoryFreeDuplicates
    // for how the bare twin this can also produce gets dropped afterward.
    if (skipsBeforeCandidates(slot)) searchSlots(slots, slotIndex + 1);
    tryEachCandidate(
      slot,
      chosen,
      dismatchedKeys,
      () => results.length >= searchBudget,
      () => !exceedsCeiling(),
      () => searchSlots(slots, slotIndex + 1),
    );
    if (slot.preferred) searchSlots(slots, slotIndex + 1);
  }

  for (const bottom of floorAwareCandidates(bottomCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo, warmthCeiling)) {
    if (results.length >= searchBudget) break;

    chosen.push(bottom);
    if (!exceedsCeiling()) {
      const slots = buildSlots(candidates, bottom, warmthFloor, needsScarf, bottom.hasBeltLoops, wornDaysAgo, { warmthCeiling });
      searchSlots(slots, 0);
    }
    chosen.pop();
  }

  return finalizeOutfits(results, maxResults);
}

/** A complete outfit alongside its computed totals and how they compare to the bounds. */
export interface ScoredOutfit {
  items: ClothingItem[];
  warmth: number;
  wind: number;
  /** Whether this outfit actually clears every bound — see generateOutfits. */
  meetsTarget: boolean;
  /** Which warmth band this outfit was picked to fill — only set by selectBandedOutfits (utils/bandedOutfits.ts); every other producer leaves it undefined. */
  band?: 'cooler' | 'median' | 'warmer';
}

/** Scores one complete candidate outfit against the bounds — the leaf case of generateClosestOutfits' search. */
function scoreOutfit(
  chosen: readonly ClothingItem[],
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): ScoredOutfit {
  const warmth = sumWarmth(chosen);
  const wind = sumWind(chosen);
  return {
    items: [...chosen],
    warmth,
    wind,
    meetsTarget:
      warmth >= warmthFloor &&
      warmth <= warmthCeiling &&
      wind >= windFloor &&
      meetsRegionFloors(chosen, warmthFloor),
  };
}

/**
 * Every complete, compatible outfit the search space contains, ranked
 * closest-to-the-bounds first — for troubleshooting why generateOutfits found
 * nothing, not for recommending an outfit. Unlike generateOutfits, this does
 * not prune on the ceiling or stop at the first `maxResults` matches: leaving
 * either in place would hide the very outfits a "why didn't anything work"
 * question needs to see, and MAX_SLOT_CANDIDATES already bounds the search
 * space to something that stays fast without it (see its own doc comment in
 * outfitSlots.ts).
 *
 * `meetsTarget` on a returned outfit means it actually clears every bound —
 * this can only happen when generateOutfits' own `maxResults` cap already cut
 * it off before finding it, since otherwise it would have been returned from
 * there instead.
 */
export function generateClosestOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  maxResults: number = DEFAULT_MAX_OUTFITS,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  options: {
    anchorPool?: readonly ClothingItem[];
    includeWarmthAccessories?: boolean;
    topCandidatesOverride?: readonly ClothingItem[];
  } = {},
): ScoredOutfit[] {
  const needsScarf = warmthFloor >= SCARF_PREFERRED_WARMTH_FLOOR;
  const all: ScoredOutfit[] = [];
  const chosen: ClothingItem[] = [];

  // Every complete combination gets pushed to `all` — this view exists to
  // show near-misses, not hide them (see this function's own doc comment).
  // dropAccessoryFreeDuplicates, below, is what keeps a bare outfit from
  // cluttering the ranked results once its accessorized twin is shown too.
  function searchSlots(slots: Slot[], slotIndex: number): void {
    if (slotIndex === slots.length) {
      all.push(scoreOutfit(chosen, warmthFloor, warmthCeiling, windFloor));
      return;
    }

    const slot = slots[slotIndex];
    if (skipsBeforeCandidates(slot)) searchSlots(slots, slotIndex + 1);
    // isViable stays `() => true`: nothing is pruned by the ceiling here,
    // unlike generateOutfits — see this function's own doc comment.
    tryEachCandidate(slot, chosen, dismatchedKeys, () => false, () => true, () => searchSlots(slots, slotIndex + 1));
    if (slot.preferred) searchSlots(slots, slotIndex + 1);
  }

  const anchorPool =
    options.anchorPool ??
    floorAwareCandidates(bottomCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo, warmthCeiling);

  const slotOptions = {
    includeWarmthAccessories: options.includeWarmthAccessories,
    topCandidatesOverride: options.topCandidatesOverride,
    warmthCeiling,
  };
  for (const bottom of anchorPool) {
    chosen.push(bottom);
    searchSlots(buildSlots(candidates, bottom, warmthFloor, needsScarf, bottom.hasBeltLoops, wornDaysAgo, slotOptions), 0);
    chosen.pop();
  }

  return dropAccessoryFreeDuplicates(dropExactDuplicates(all), (outfit) => outfit.meetsTarget)
    .sort((a, b) => {
      const distance =
        distanceFromBounds(a.items, a.warmth, a.wind, warmthFloor, warmthCeiling, windFloor) -
        distanceFromBounds(b.items, b.warmth, b.wind, warmthFloor, warmthCeiling, windFloor);
      if (distance !== 0) return distance;
      // Tie-break: prefer the outfit carrying more preferred accessories
      // (Bag, Scarf, Tights — see PREFERRED_ACCESSORY_GROUPS) before falling
      // through to warmth or search order below.
      //
      // dropAccessoryFreeDuplicates, above, only ever compares an outfit
      // against its own literal superset — the same Belt plus a Bag added on
      // top — so it already prefers an accessorized outfit over its bare
      // twin. It has no way to compare across two outfits that differ in
      // which *required* item they used to get there: a Gold-hardware Belt
      // that has no compatible Bag versus a Silver-hardware Belt that does
      // are two different, non-superset outfits by that check, tied on every
      // weather measure since Belt and Bag both contribute 0 warmth (see
      // outfitScoring.ts's WARMTH_BY_CATEGORY) — so without this, the one
      // search happened to visit first (Belt pool order, see accessoryFirst
      // in outfitCandidatePools.ts) won regardless of whether it could carry
      // a bag at all. Reported bug: a Gold belt with no matching bag kept
      // outranking a Silver belt with one, for exactly this reason, and
      // selectDiverseOutfits (outfitDiversity.ts) treats same-Top/Bottom
      // outfits differing only by Belt as one combo, keeping just the
      // top-ranked one — so this tie-break is what actually decides which
      // Belt/Bag pairing reaches the user.
      const accessoryCount = (items: readonly ClothingItem[]): number =>
        items.filter((item) => PREFERRED_ACCESSORY_GROUPS.has(CATEGORY_GROUP[item.category])).length;
      const accessories = accessoryCount(b.items) - accessoryCount(a.items);
      if (accessories !== 0) return accessories;
      // Tie-break: when the weather calls for any real warmth at all,
      // prefer the warmer of two outfits that are otherwise equally close to
      // the bounds (both within them, or both short by the same amount) —
      // see the reported bug this guards against, below. Left alone
      // (returning 0, so JS's stable sort keeps search-encounter order —
      // lean-first, see floorAwareCandidates' warmthFloor<=0 branch in
      // outfitCandidatePools.ts) whenever warmthFloor is 0: there is nothing
      // to stay warm against, so preferring the leaner of two equally-valid
      // options is still the right default on a mild or hot day.
      //
      // Reported bug: at -14°C, a sleeveless top (0 warmth) plus a Cardigan
      // ties, at distance 0, with a T-Shirt or a wool Sweater the closet also
      // had — both combinations clear every bound, so nothing about distance
      // alone favoured the warmer choice, and lean-first search order (the
      // sleeveless top sorts before either alternative — see
      // floorAwareCandidates' warmthFloor<=0 branch) meant the coldest
      // still-technically-valid outfit won by default, every time, rather
      // than the one with real margin above the floor.
      return warmthFloor > 0 ? b.warmth - a.warmth : 0;
    })
    .slice(0, maxResults);
}
