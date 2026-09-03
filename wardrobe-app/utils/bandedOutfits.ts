import { bottomCandidatesFor, baseTopCandidates, rankWithFairTiebreak, recencyPenalty } from './outfitCandidatePools';
import { generateClosestOutfits, type OutfitCandidates, type ScoredOutfit } from './outfitGenerator';
import { topUpToward, compatibleTopUpPools, type TopUpPools } from './warmthTopUp';
import { LEG_WARMTH_FLOOR_FRACTION, TORSO_WARMTH_FLOOR_FRACTION, LEG_WARMTH_CEILING_WEIGHT, TORSO_WARMTH_CEILING_WEIGHT } from './outfitScoring';
import type { WarmthBand } from './warmthBands';
import type { ClothingItem } from '../types/wardrobe';

/**
 * The candidate-pool-widening slice size mergedByBandCenters uses -- larger
 * than MAX_SLOT_CANDIDATES (which bounds a single outfit slot's own search
 * branching cost) because this pool represents every plausible bottom/top
 * across a real, ~20-40-item-per-category wardrobe, not one slot's
 * candidates. Safe from the branching-cost concern MAX_SLOT_CANDIDATES'
 * own doc comment warns about: coreOutfitsForBands runs generateClosestOutfits
 * as one search per day (see its own doc comment), not once per band and
 * not once per DFS branch, so a larger merged pool costs more once, not
 * once per branch -- verified empirically, not assumed (see
 * bandedOutfits.test.ts's own performance regression test).
 *
 * Reported bug this fixes: a valid mid-range item (a silk skirt, on a real
 * wardrobe) never entered the search at all -- not because it was a poor
 * fit, but because too many other items competed for the old, fixed
 * 3-item "warmest-under-ceiling" slice across all three band calls, before
 * the outfit search ever ran.
 */
const BAND_POOL_SLOT_SIZE = 15;

/**
 * Which band's turn comes last -- and is therefore more likely to fall
 * back to a closest-available result on a constrained wardrobe -- depends
 * on today's warmthFloor. Median always goes first; warmer matters less
 * to prioritize on a hot day than cooler does, and vice versa in the
 * cold, per direct feedback ("prioritise cool outfits in summer, and
 * warm outfits in winter").
 *
 * warmthFloor === 0 exactly captures "at or above the 20°C neutral point"
 * (see WARMTH_NEUTRAL_TEMP_C in utils/thermal.ts) without needing
 * feltTempC threaded through this function separately -- warmthFloor(20)
 * is exactly 0, so 20°C itself lands on the warm (warmer-last) side.
 */
export function bandOrderFor(warmthFloor: number): ('median' | 'cooler' | 'warmer')[] {
  return warmthFloor === 0 ? ['median', 'cooler', 'warmer'] : ['median', 'warmer', 'cooler'];
}

/**
 * Picks the single item in `items` closest to `target` on the raw,
 * per-item inferredWarmth scale -- used once per band by
 * mergedByBandCenters to anchor that band's own floor requirement, the
 * same "closest to floor" logic floorAwareCandidates itself uses
 * internally (see outfitCandidatePools.ts), extracted here since
 * mergedByBandCenters no longer calls that function.
 */
function closestToTarget(
  items: readonly ClothingItem[],
  target: number,
  wornDaysAgo: ReadonlyMap<string, number>,
): ClothingItem | undefined {
  return [...items].sort((a, b) => {
    const byDistance = Math.abs(a.inferredWarmth - target) - Math.abs(b.inferredWarmth - target);
    return byDistance !== 0 ? byDistance : recencyPenalty(a, wornDaysAgo) - recencyPenalty(b, wornDaysAgo);
  })[0];
}

/**
 * Samples up to `slotSize` items evenly spread across the full sorted-by-
 * insulation range of `items` under `warmthCeiling`, rather than clustering
 * at the two extremes the way floorAwareCandidates' leanest/warmest split
 * does. mergedByBandCenters' own merged, band-wide pool needs full-range
 * coverage -- a mid-range item must be reachable -- not just cheap and
 * maximal options.
 *
 * Reported bug this fixes: a valid mid-range item (a silk skirt, on a real
 * wardrobe) never entered the search at all, even after Tasks 1-2's pool
 * widening and Task 3b's ceiling-scaling fix -- the leanest-half/warmest-
 * half split structurally excludes anything in the middle once the
 * eligible pool exceeds slotSize, independent of pool size or ceiling
 * correctness.
 *
 * Each bucket's own representative is picked at random from within that
 * bucket (jittered), not always the same relative position -- a fixed
 * grid position (e.g. always the bucket's first item) guarantees the SAME
 * items are always skipped for a given (poolSize, slotSize) pair, which is
 * exactly how a real item (a silk skirt, "Arket") was permanently
 * unreachable despite this function's own full-range coverage goal. A
 * bucket of size 1 is still always included (no randomness where there's
 * no choice); only multi-item buckets vary call to call.
 */
function evenlySampled(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number>,
  warmthCeiling: number,
  slotSize: number,
): ClothingItem[] {
  const underCeiling = items.filter((item) => item.inferredWarmth <= warmthCeiling);
  const eligible = underCeiling.length > 0 ? underCeiling : items;
  const sorted = rankWithFairTiebreak(eligible, wornDaysAgo);
  if (sorted.length <= slotSize) return sorted;

  const sampled = new Map<string, ClothingItem>();
  for (let bucket = 0; bucket < slotSize; bucket++) {
    const start = Math.floor((bucket * sorted.length) / slotSize);
    const end = Math.floor(((bucket + 1) * sorted.length) / slotSize);
    const pick = start + Math.floor(Math.random() * (end - start));
    sampled.set(sorted[pick].id, sorted[pick]);
  }
  return [...sampled.values()];
}

/**
 * Builds mergedByBandCenters' own merged, band-wide candidate pool: one
 * full-range evenly-sampled base (see evenlySampled -- computed once, not
 * once per band, since it doesn't depend on any band's own target) plus
 * each band's own closest-to-floor anchor item (still per-band, since each
 * band's own floor requirement genuinely differs).
 */
function mergedByBandCenters(
  items: readonly ClothingItem[],
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  regionFraction: number,
  wornDaysAgo: ReadonlyMap<string, number>,
  warmthCeiling: number,
  ceilingRegionWeight: number,
): ClothingItem[] {
  const merged = new Map<string, ClothingItem>();
  for (const candidate of evenlySampled(items, wornDaysAgo, warmthCeiling / ceilingRegionWeight, BAND_POOL_SLOT_SIZE)) {
    merged.set(candidate.id, candidate);
  }
  for (const band of [bands.cooler, bands.median, bands.warmer]) {
    const closest = closestToTarget(items, band.center * regionFraction, wornDaysAgo);
    if (closest) merged.set(closest.id, closest);
  }
  return [...merged.values()];
}

/**
 * The ranked core-outfit list (Scarf/Tights excluded, see the design spec's
 * "Core search" section) that selectBandedOutfits (Task 7) buckets into
 * bands and tops up. One search, not three: the anchor and Top pools are
 * each widened up front by merging a band-targeted floorAwareCandidates
 * call per band, then generateClosestOutfits runs once over that merged
 * pool -- ranking (closest to the real warmthFloor/warmthCeiling/windFloor)
 * is unaffected, only which candidates the search considers changes.
 */
export function coreOutfitsForBands(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ScoredOutfit[] {
  const anchorPool = mergedByBandCenters(
    bottomCandidatesFor(candidates, warmthFloor),
    bands,
    LEG_WARMTH_FLOOR_FRACTION,
    wornDaysAgo,
    warmthCeiling,
    LEG_WARMTH_CEILING_WEIGHT,
  );
  const topPool = mergedByBandCenters(
    baseTopCandidates(candidates.tops, warmthFloor),
    bands,
    TORSO_WARMTH_FLOOR_FRACTION,
    wornDaysAgo,
    warmthCeiling,
    TORSO_WARMTH_CEILING_WEIGHT,
  );

  return generateClosestOutfits(candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, Infinity, wornDaysAgo, {
    anchorPool,
    includeWarmthAccessories: false,
    topCandidatesOverride: topPool,
  });
}

/** Categories excluded from the global reuse tracker entirely -- unlimited reuse, no freshness penalty, no cap. Tights per the original design spec's "Top-up items" ruling; Bag/Belt/Scarf per direct feedback: a bag should always be recommended, a belt with any belt-loop bottom, and a scarf as often as needed -- some wardrobes only own one of each, and none of them should compete with Bottoms/Tops/Outerwear/Shoes for reuse budget. */
const UNTRACKED_CATEGORIES: ReadonlySet<ClothingItem['category']> = new Set(['Tights', 'Bag', 'Belt', 'Scarf']);

/** Every item id in `outfit` that counts toward the global reuse tracker -- see UNTRACKED_CATEGORIES for what's excluded and why. */
function trackedItemIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => !UNTRACKED_CATEGORIES.has(item.category)).map((item) => item.id);
}

/**
 * Applies topUpToward to every core outfit for `band`, with no sort --
 * the expensive, order-independent part of ranking (topUpToward is
 * band-specific but does not depend on what any other band has claimed),
 * kept separate from rankNow's cheap, live re-sort below. Computed once
 * per band regardless of pick order -- see selectBandedOutfits.
 */
export function toppedUpForBand(
  core: readonly ScoredOutfit[],
  band: WarmthBand,
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  wornDaysAgo: ReadonlyMap<string, number>,
  poolsByOutfit: ReadonlyMap<ScoredOutfit, TopUpPools>,
): ScoredOutfit[] {
  return core.map((outfit) =>
    topUpToward(
      outfit,
      band,
      candidates,
      dismatchedKeys,
      warmthFloor,
      warmthCeiling,
      windFloor,
      wornDaysAgo,
      poolsByOutfit.get(outfit),
    ),
  );
}

/**
 * How many of `outfit`'s own tracked items (see trackedItemIds -- every
 * category except Tights) are already claimed by an earlier band's picks,
 * per `useCounts`. 0 (fully fresh) is best.
 */
export function freshnessPenalty(outfit: ScoredOutfit, useCounts: ReadonlyMap<string, number>): number {
  return trackedItemIds(outfit).filter((id) => (useCounts.get(id) ?? 0) >= 1).length;
}

/**
 * Re-sorts an already-topped-up list (see toppedUpForBand) live, using
 * whatever `useCounts` state exists right now. Cheap (a map lookup per
 * candidate), unlike toppedUpForBand's own topUpToward pass -- safe to
 * call fresh every time a band (or a donor being borrowed from) is about
 * to pick, so the ranking always reflects exactly what's been claimed so
 * far.
 *
 * Reported bug this exists to fix: a single "best" Top+Outerwear pairing
 * numerically beats almost every other pairing for a high warmth target,
 * regardless of which Bottom it's paired with. Once two earlier bands
 * have legitimately claimed its max-2 reuse budget, the band picked last
 * still saw that same pairing (with a third Bottom) ranked first by pure
 * distance-to-center -- rejected by the reuse rule, over and over,
 * while a genuinely different, valid Top/Outerwear pairing sat far down
 * the list. meetsTarget still wins first; freshness is the new middle
 * tier; inBand (is this candidate within THIS band's own [min,max], not
 * just today's overall floor-ceiling) is next; freshness breaks ties within
 * the same inBand bucket; distance to band.center is the final tiebreak.
 */

/** Whether `outfit`'s warmth actually falls within THIS band's own [min, max] sub-range, not just the day's overall floor-ceiling. */
function inBand(outfit: ScoredOutfit, band: WarmthBand): boolean {
  return outfit.warmth >= band.min && outfit.warmth <= band.max;
}

/** Whether `outfit` shares any tracked item with `pickedThisBandIds` -- this band's own picks so far, computed fresh by fillBandTiered as it fills. 1 (deprioritized) if so, 0 if fully distinct from this band's own choices. */
function sameBandRepeatPenalty(outfit: ScoredOutfit, pickedThisBandIds: ReadonlySet<string>): number {
  return trackedItemIds(outfit).some((id) => pickedThisBandIds.has(id)) ? 1 : 0;
}

export function rankNow(
  toppedUp: readonly ScoredOutfit[],
  band: WarmthBand,
  useCounts: ReadonlyMap<string, number>,
  pickedThisBandIds: ReadonlySet<string> = new Set(),
): ScoredOutfit[] {
  return [...toppedUp].sort((a, b) => {
    if (a.meetsTarget !== b.meetsTarget) return a.meetsTarget ? -1 : 1;
    const inBandA = inBand(a, band);
    const inBandB = inBand(b, band);
    if (inBandA !== inBandB) return inBandA ? -1 : 1;
    const repeatA = sameBandRepeatPenalty(a, pickedThisBandIds);
    const repeatB = sameBandRepeatPenalty(b, pickedThisBandIds);
    if (repeatA !== repeatB) return repeatA - repeatB;
    const freshA = freshnessPenalty(a, useCounts);
    const freshB = freshnessPenalty(b, useCounts);
    if (freshA !== freshB) return freshA - freshB;
    return Math.abs(a.warmth - band.center) - Math.abs(b.warmth - band.center);
  });
}

type BandName = 'cooler' | 'median' | 'warmer';

/**
 * Fills one band's 2 slots by walking `tiers` in order -- each tier tried
 * across `sources` (the band itself, then its donors, per borrowOrder)
 * before the next, stricter-to-looser tier is ever touched. Extracted from
 * selectBandedOutfits purely to keep that function within the project's
 * line-count limit; see the tiers array at its one call site for what each
 * tier means.
 */
function fillBandTiered(
  sources: readonly BandName[],
  toppedUpByBand: Record<BandName, ScoredOutfit[]>,
  bands: Record<BandName, WarmthBand>,
  useCounts: ReadonlyMap<string, number>,
  pickUpTo: (
    ranked: readonly ScoredOutfit[],
    need: number,
    requireMeetsTarget: boolean,
    violatesCap: (outfit: ScoredOutfit) => boolean,
  ) => ScoredOutfit[],
  tiers: readonly [boolean, (outfit: ScoredOutfit) => boolean][],
  need: number,
): ScoredOutfit[] {
  let picked: ScoredOutfit[] = [];
  for (const [requireMeetsTarget, violatesCap] of tiers) {
    if (picked.length === need) break;
    for (const source of sources) {
      if (picked.length === need) break;
      const pickedThisBandIds = new Set(picked.flatMap(trackedItemIds));
      picked = [
        ...picked,
        ...pickUpTo(
          rankNow(toppedUpByBand[source], bands[source], useCounts, pickedThisBandIds),
          need - picked.length,
          requireMeetsTarget,
          violatesCap,
        ),
      ];
    }
  }
  return picked;
}

interface ReuseTracker {
  /** Live view of today's per-item use counts, for rankNow's own freshness tiebreak. */
  useCounts: ReadonlyMap<string, number>;
  /** Hard safety-net cap: an item may never appear in more than 2 of the day's shown outfits, and a second use may never overlap the first use's outfit on any other item (no near-duplicate outfit pair). The fallback tier -- see violatesFreshnessPreference for the preferred, stricter tier tried first. */
  violatesUniqueness(outfit: ScoredOutfit): boolean;
  /** Preferred tier: an item should appear in at most 1 of the day's shown outfits. Tried before violatesUniqueness's looser cap-2 fallback, so a genuinely scarce wardrobe (one bag, one valid trouser) still fills every slot -- it just falls through to the cap-2 tier to do it, rather than this tier blocking outright. */
  violatesFreshnessPreference(outfit: ScoredOutfit): boolean;
  /** Picks up to `need` outfits, recording (and permanently consuming reuse budget for) only what it actually keeps -- never records a candidate it evaluates but then discards, which would silently tighten the reuse cap for outfits the user never sees. `requireMeetsTarget` and `violatesCap` let the caller run this same walk at different tiers of strictness (see the 4-tier `tiers` array in selectBandedOutfits). */
  pickUpTo(
    ranked: readonly ScoredOutfit[],
    need: number,
    requireMeetsTarget: boolean,
    violatesCap: (outfit: ScoredOutfit) => boolean,
  ): ScoredOutfit[];
  /** Records an already-decided outfit's tracked items against the reuse budget without walking any ranked list -- used to seed the tracker with outfits the caller is keeping from a prior selectBandedOutfits call (see selectBandedOutfits' alreadyClaimed parameter), so bands still being searched correctly treat those items as already used. */
  claim(outfit: ScoredOutfit): void;
}

/** Records every `alreadyClaimed` outfit against the reuse tracker and groups them by their own `.band` tag, so selectBandedOutfits can skip or partially fill each band's search accordingly. Extracted purely to keep selectBandedOutfits within the project's line-count limit. */
function groupAlreadyClaimed(
  alreadyClaimed: readonly ScoredOutfit[],
  claim: (outfit: ScoredOutfit) => void,
): Record<BandName, ScoredOutfit[]> {
  const claimedByBand: Record<BandName, ScoredOutfit[]> = { cooler: [], median: [], warmer: [] };
  for (const outfit of alreadyClaimed) {
    claim(outfit);
    if (outfit.band) claimedByBand[outfit.band].push(outfit);
  }
  return claimedByBand;
}

/**
 * Fills one band's `results` entry: the already-claimed outfits for it if 2
 * were supplied, otherwise those plus whatever fillBandTiered finds for the
 * remaining slots. Extracted purely to keep selectBandedOutfits within the
 * project's line-count limit.
 */
function resultsForBand(
  bandName: BandName,
  claimedByBand: Record<BandName, ScoredOutfit[]>,
  borrowOrder: Record<BandName, BandName[]>,
  toppedUpByBand: Record<BandName, ScoredOutfit[]>,
  bands: Record<BandName, WarmthBand>,
  useCounts: ReadonlyMap<string, number>,
  pickUpTo: ReuseTracker['pickUpTo'],
  tiers: readonly [boolean, (outfit: ScoredOutfit) => boolean][],
): ScoredOutfit[] {
  const claimed = claimedByBand[bandName].slice(0, 2);
  if (claimed.length === 2) return claimed;
  const sources = [bandName, ...borrowOrder[bandName]];
  const picked = fillBandTiered(sources, toppedUpByBand, bands, useCounts, pickUpTo, tiers, 2 - claimed.length);
  // Tagged with the band slot being filled, not the band it was ranked/
  // topped-up for — a borrowed outfit still fills bandName's slot, and this
  // tag is what the UI (TodayScreen.tsx) groups and labels by.
  return [...claimed, ...picked.map((outfit) => ({ ...outfit, band: bandName }))];
}

/** Owns the day's useCounts/firstUse state and every reuse-cap check built on it. Extracted from selectBandedOutfits purely to keep that function within the project's line-count limit. */
function createReuseTracker(): ReuseTracker {
  const useCounts = new Map<string, number>();
  const firstUse = new Map<string, ScoredOutfit>();

  function violatesUniqueness(outfit: ScoredOutfit): boolean {
    const ids = trackedItemIds(outfit);
    for (const id of ids) {
      const count = useCounts.get(id) ?? 0;
      if (count >= 2) return true;
      if (count === 1) {
        const sibling = firstUse.get(id);
        if (sibling) {
          const siblingIds = new Set(trackedItemIds(sibling));
          const overlapsOnAnotherItem = ids.some((otherId) => otherId !== id && siblingIds.has(otherId));
          if (overlapsOnAnotherItem) return true;
        }
      }
    }
    return false;
  }

  function violatesFreshnessPreference(outfit: ScoredOutfit): boolean {
    return trackedItemIds(outfit).some((id) => (useCounts.get(id) ?? 0) >= 1);
  }

  function record(outfit: ScoredOutfit): void {
    for (const id of trackedItemIds(outfit)) {
      const count = useCounts.get(id) ?? 0;
      if (count === 0) firstUse.set(id, outfit);
      useCounts.set(id, count + 1);
    }
  }

  function pickUpTo(
    ranked: readonly ScoredOutfit[],
    need: number,
    requireMeetsTarget: boolean,
    violatesCap: (outfit: ScoredOutfit) => boolean,
  ): ScoredOutfit[] {
    const picked: ScoredOutfit[] = [];
    const pickedIdsThisCall = new Set<string>();

    const tryPass = (allowSelfRepeat: boolean): void => {
      for (const outfit of ranked) {
        if (picked.length === need) break;
        if (requireMeetsTarget && !outfit.meetsTarget) continue;
        if (violatesCap(outfit)) continue;
        if (!allowSelfRepeat && trackedItemIds(outfit).some((id) => pickedIdsThisCall.has(id))) continue;
        record(outfit);
        picked.push(outfit);
        for (const id of trackedItemIds(outfit)) pickedIdsThisCall.add(id);
      }
    };

    tryPass(false);
    if (picked.length < need) tryPass(true);

    return picked;
  }

  return { useCounts, violatesUniqueness, violatesFreshnessPreference, pickUpTo, claim: record };
}

export function selectBandedOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  alreadyClaimed: readonly ScoredOutfit[] = [],
): ScoredOutfit[] {
  const core = coreOutfitsForBands(
    candidates,
    dismatchedKeys,
    warmthFloor,
    warmthCeiling,
    windFloor,
    bands,
    wornDaysAgo,
  );

  const poolsByOutfit = new Map<ScoredOutfit, TopUpPools>(
    core.map((outfit) => [outfit, compatibleTopUpPools(outfit, candidates, dismatchedKeys)]),
  );

  const { useCounts, violatesUniqueness, violatesFreshnessPreference, pickUpTo, claim } = createReuseTracker();
  const claimedByBand = groupAlreadyClaimed(alreadyClaimed, claim);

  const toppedUpByBand = {
    cooler: toppedUpForBand(core, bands.cooler, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, wornDaysAgo, poolsByOutfit),
    median: toppedUpForBand(core, bands.median, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, wornDaysAgo, poolsByOutfit),
    warmer: toppedUpForBand(core, bands.warmer, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, wornDaysAgo, poolsByOutfit),
  };

  const order = bandOrderFor(warmthFloor);
  const borrowOrder: Record<keyof typeof toppedUpByBand, (keyof typeof toppedUpByBand)[]> = {
    median: ['cooler', 'warmer'],
    cooler: ['median', 'warmer'],
    warmer: ['median', 'cooler'],
  };

  // Four tiers, tried in order, each across own-band-then-donors before the
  // next tier is ever touched: (1) valid + fresh, (2) valid + reused (only
  // when a scarce wardrobe has no fresh valid alternative), (3) invalid +
  // fresh, (4) invalid + reused -- today's original last-resort fallback.
  // Validity is checked before freshness at every step, so an over-ceiling
  // outfit is never shown while a same-day valid alternative -- in this
  // band OR a donor's -- still exists unclaimed or reusable.
  const tiers: readonly [boolean, (outfit: ScoredOutfit) => boolean][] = [
    [true, violatesFreshnessPreference],
    [true, violatesUniqueness],
    [false, violatesFreshnessPreference],
    [false, violatesUniqueness],
  ];

  const results: ScoredOutfit[] = [];
  for (const bandName of order) {
    results.push(
      ...resultsForBand(bandName, claimedByBand, borrowOrder, toppedUpByBand, bands, useCounts, pickUpTo, tiers),
    );
  }

  return results;
}
