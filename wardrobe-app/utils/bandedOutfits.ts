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
 */
function mergedByBandCenters(
  items: readonly ClothingItem[],
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  regionFraction: number,
  wornDaysAgo: ReadonlyMap<string, number>,
): ClothingItem[] {
  const merged = new Map<string, ClothingItem>();
  for (const band of [bands.cooler, bands.median, bands.warmer]) {
    for (const candidate of floorAwareCandidates(items, band.center * regionFraction, wornDaysAgo)) {
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
  );
  const topPool = mergedByBandCenters(
    baseTopCandidates(candidates.tops, warmthFloor),
    bands,
    TORSO_WARMTH_FLOOR_FRACTION,
    wornDaysAgo,
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
 * Ranks `core` outfits by closeness to `band.center` after topping each one
 * up -- the per-band ranked list selectBandedOutfits' greedy pass walks.
 *
 * Outfits that actually meetTarget always rank ahead of ones that don't,
 * regardless of raw distance to band.center -- reported bug: a bare-legged
 * Skirt/Dress padded with a heavy Coat and Tights can land numerically
 * closer to a band's center (band.center is a whole-outfit total, easily
 * reached by piling on Outerwear) than a genuinely valid Pants-based
 * outfit sitting a little further from center, even though the padded
 * outfit fails its own leg-region floor and the Pants one doesn't. A pure
 * distance sort had no way to prefer the outfit that actually works;
 * meetsTarget is checked first, distance only breaks a tie within each
 * group.
 *
 * `poolsByOutfit`, keyed by outfit object identity (stable across all three
 * band calls, since every call shares the same `core` array), lets
 * topUpToward skip re-filtering the same outfit's compatible scarves/tights
 * three times over -- see compatibleTopUpPools' own doc comment.
 */
function rankedForBand(
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
  return core
    .map((outfit) =>
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
    )
    .sort((a, b) => {
      if (a.meetsTarget !== b.meetsTarget) return a.meetsTarget ? -1 : 1;
      return Math.abs(a.warmth - band.center) - Math.abs(b.warmth - band.center);
    });
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

  function record(outfit: ScoredOutfit): void {
    for (const id of trackedItemIds(outfit)) {
      const count = useCounts.get(id) ?? 0;
      if (count === 0) firstUse.set(id, outfit);
      useCounts.set(id, count + 1);
    }
  }

  /** Picks up to `need` outfits, recording (and permanently consuming reuse budget for) only what it actually keeps -- never records a candidate it evaluates but then discards, which would silently tighten the max-2 ceiling for outfits the user never sees. */
  function pickUpTo(ranked: readonly ScoredOutfit[], need: number): ScoredOutfit[] {
    const picked: ScoredOutfit[] = [];
    for (const outfit of ranked) {
      if (picked.length === need) break;
      if (violatesUniqueness(outfit)) continue;
      record(outfit);
      picked.push(outfit);
    }
    return picked;
  }

  const rankedByBand = {
    cooler: rankedForBand(core, bands.cooler, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, wornDaysAgo, poolsByOutfit),
    median: rankedForBand(core, bands.median, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, wornDaysAgo, poolsByOutfit),
    warmer: rankedForBand(core, bands.warmer, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, wornDaysAgo, poolsByOutfit),
  };

  const order: (keyof typeof rankedByBand)[] = ['median', 'cooler', 'warmer'];
  const borrowOrder: Record<keyof typeof rankedByBand, (keyof typeof rankedByBand)[]> = {
    median: ['cooler', 'warmer'],
    cooler: ['median', 'warmer'],
    warmer: ['median', 'cooler'],
  };

  const results: ScoredOutfit[] = [];
  for (const bandName of order) {
    let picked = pickUpTo(rankedByBand[bandName], 2);
    for (const donor of borrowOrder[bandName]) {
      if (picked.length === 2) break;
      picked = [...picked, ...pickUpTo(rankedByBand[donor], 2 - picked.length)];
    }
    // Tagged with the band slot being filled, not the band it was ranked/
    // topped-up for — a borrowed outfit still fills bandName's slot, and
    // this tag is what the UI (TodayScreen.tsx) groups and labels by.
    results.push(...picked.map((outfit) => ({ ...outfit, band: bandName })));
  }

  return results;
}
