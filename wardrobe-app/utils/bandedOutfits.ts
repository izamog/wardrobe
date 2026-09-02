import { floorAwareCandidates, bottomCandidatesFor, baseTopCandidates } from './outfitCandidatePools';
import { generateClosestOutfits, type OutfitCandidates, type ScoredOutfit } from './outfitGenerator';
import { topUpToward, compatibleTopUpPools, type TopUpPools } from './warmthTopUp';
import { LEG_WARMTH_FLOOR_FRACTION, TORSO_WARMTH_FLOOR_FRACTION } from './outfitScoring';
import type { WarmthBand } from './warmthBands';
import type { ClothingItem } from '../types/wardrobe';

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
 * Merges floorAwareCandidates run once per band into one deduped pool -- see
 * the design spec's "Pool widening" ruling for why this is a static,
 * up-front merge rather than a dynamic re-search.
 *
 * `regionFraction` (LEG_WARMTH_FLOOR_FRACTION or TORSO_WARMTH_FLOOR_FRACTION)
 * scales each band's own whole-outfit `center` down to the same raw,
 * per-item inferredWarmth scale floorAwareCandidates' own "closest to
 * target" tiebreak compares against (see outfitCandidatePools.ts) -- a
 * single Bottom or Top item's own inferredWarmth is never on the same scale
 * as a whole outfit's weighted warmth total, so ranking a Bottom pool
 * against a bare band.center measured a single trouser against a number
 * roughly LEG_WARMTH_FLOOR_FRACTION's reciprocal too large. Scaling by the
 * same fraction the leg/torso region floors themselves use keeps this
 * per-band varying (each band's own center still differs) while bringing it
 * into the right units.
 *
 * `warmthCeiling`, scaled by the same `regionFraction`, is passed through to
 * floorAwareCandidates so its warmest half stays honest on a hot, tight-
 * ceiling day -- see that function's own doc comment. Without it, every
 * band's own contribution to this merged pool pulled in the same genuinely-
 * warmest-overall items regardless of how low today's ceiling was, so the
 * union across all three bands never surfaced a mid-warmth item either: the
 * root cause of a reported bug where a warmth-5-class bottom was shown over
 * a ceiling of 2 on a real wardrobe with plenty of lighter, valid options
 * that the search never even got to see.
 */
function mergedByBandCenters(
  items: readonly ClothingItem[],
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  regionFraction: number,
  wornDaysAgo: ReadonlyMap<string, number>,
  warmthCeiling: number,
): ClothingItem[] {
  const merged = new Map<string, ClothingItem>();
  for (const band of [bands.cooler, bands.median, bands.warmer]) {
    for (const candidate of floorAwareCandidates(
      items,
      band.center * regionFraction,
      wornDaysAgo,
      warmthCeiling * regionFraction,
    )) {
      merged.set(candidate.id, candidate);
    }
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
  );
  const topPool = mergedByBandCenters(
    baseTopCandidates(candidates.tops, warmthFloor),
    bands,
    TORSO_WARMTH_FLOOR_FRACTION,
    wornDaysAgo,
    warmthCeiling,
  );

  return generateClosestOutfits(candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, Infinity, wornDaysAgo, {
    anchorPool,
    includeWarmthAccessories: false,
    topCandidatesOverride: topPool,
  });
}

/** Every item id in `outfit` that counts toward the global reuse tracker -- every category except Tights, per the design spec's "Top-up items" ruling. */
function trackedItemIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => item.category !== 'Tights').map((item) => item.id);
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
 * tier; distance to band.center is the final tiebreak.
 */
export function rankNow(
  toppedUp: readonly ScoredOutfit[],
  band: WarmthBand,
  useCounts: ReadonlyMap<string, number>,
): ScoredOutfit[] {
  return [...toppedUp].sort((a, b) => {
    if (a.meetsTarget !== b.meetsTarget) return a.meetsTarget ? -1 : 1;
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
): ScoredOutfit[] {
  let picked: ScoredOutfit[] = [];
  for (const [requireMeetsTarget, violatesCap] of tiers) {
    if (picked.length === 2) break;
    for (const source of sources) {
      if (picked.length === 2) break;
      picked = [
        ...picked,
        ...pickUpTo(rankNow(toppedUpByBand[source], bands[source], useCounts), 2 - picked.length, requireMeetsTarget, violatesCap),
      ];
    }
  }
  return picked;
}

export function selectBandedOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
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

  const useCounts = new Map<string, number>();
  const firstUse = new Map<string, ScoredOutfit>();

  /** Hard safety-net cap: an item may never appear in more than 2 of the day's shown outfits, and a second use may never overlap the first use's outfit on any other item (no near-duplicate outfit pair). This is the fallback tier -- see violatesFreshnessPreference for the preferred, stricter tier tried first. */
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

  /** Preferred tier: an item should appear in at most 1 of the day's shown outfits. Tried before violatesUniqueness's looser cap-2 fallback, so a genuinely scarce wardrobe (one bag, one valid trouser) still fills every slot -- it just falls through to the cap-2 tier to do it, rather than this tier blocking outright. */
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

  /** Picks up to `need` outfits, recording (and permanently consuming reuse budget for) only what it actually keeps -- never records a candidate it evaluates but then discards, which would silently tighten the reuse cap for outfits the user never sees. `requireMeetsTarget` and `violatesCap` let the caller run this same walk at different tiers of strictness (see the 4-tier fill loop in selectBandedOutfits). */
  function pickUpTo(
    ranked: readonly ScoredOutfit[],
    need: number,
    requireMeetsTarget: boolean,
    violatesCap: (outfit: ScoredOutfit) => boolean,
  ): ScoredOutfit[] {
    const picked: ScoredOutfit[] = [];
    for (const outfit of ranked) {
      if (picked.length === need) break;
      if (requireMeetsTarget && !outfit.meetsTarget) continue;
      if (violatesCap(outfit)) continue;
      record(outfit);
      picked.push(outfit);
    }
    return picked;
  }

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
    const sources = [bandName, ...borrowOrder[bandName]];
    const picked = fillBandTiered(sources, toppedUpByBand, bands, useCounts, pickUpTo, tiers);
    // Tagged with the band slot being filled, not the band it was ranked/
    // topped-up for — a borrowed outfit still fills bandName's slot, and
    // this tag is what the UI (TodayScreen.tsx) groups and labels by.
    results.push(...picked.map((outfit) => ({ ...outfit, band: bandName })));
  }

  return results;
}
