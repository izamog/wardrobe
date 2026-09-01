import { floorAwareCandidates, bottomCandidatesFor, baseTopCandidates } from './outfitCandidatePools';
import { generateClosestOutfits, type OutfitCandidates, type ScoredOutfit } from './outfitGenerator';
import { topUpToward } from './warmthTopUp';
import type { WarmthBand } from './warmthBands';
import type { ClothingItem } from '../types/wardrobe';

/** Merges floorAwareCandidates run once per band (each targeting that band's own center) into one deduped pool -- see the design spec's "Pool widening" ruling for why this is a static, up-front merge rather than a dynamic re-search. */
function mergedByBandCenters(
  items: readonly ClothingItem[],
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  wornDaysAgo: ReadonlyMap<string, number>,
): ClothingItem[] {
  const merged = new Map<string, ClothingItem>();
  for (const band of [bands.cooler, bands.median, bands.warmer]) {
    for (const candidate of floorAwareCandidates(items, band.center, wornDaysAgo)) {
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
  const anchorPool = mergedByBandCenters(bottomCandidatesFor(candidates, warmthFloor), bands, wornDaysAgo);
  const topPool = mergedByBandCenters(baseTopCandidates(candidates.tops, warmthFloor), bands, wornDaysAgo);

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

/** Ranks `core` outfits by closeness to `band.center` after topping each one up -- the per-band ranked list selectBandedOutfits' greedy pass walks. */
function rankedForBand(
  core: readonly ScoredOutfit[],
  band: WarmthBand,
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): ScoredOutfit[] {
  return core
    .map((outfit) => topUpToward(outfit, band, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor))
    .sort((a, b) => Math.abs(a.warmth - band.center) - Math.abs(b.warmth - band.center));
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

  function pickTwo(ranked: readonly ScoredOutfit[]): ScoredOutfit[] {
    const picked: ScoredOutfit[] = [];
    for (const outfit of ranked) {
      if (picked.length === 2) break;
      if (violatesUniqueness(outfit)) continue;
      record(outfit);
      picked.push(outfit);
    }
    return picked;
  }

  const rankedByBand = {
    cooler: rankedForBand(core, bands.cooler, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor),
    median: rankedForBand(core, bands.median, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor),
    warmer: rankedForBand(core, bands.warmer, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor),
  };

  const order: (keyof typeof rankedByBand)[] = ['median', 'cooler', 'warmer'];
  const borrowOrder: Record<keyof typeof rankedByBand, (keyof typeof rankedByBand)[]> = {
    median: ['cooler', 'warmer'],
    cooler: ['median', 'warmer'],
    warmer: ['median', 'cooler'],
  };

  const results: ScoredOutfit[] = [];
  for (const bandName of order) {
    let picked = pickTwo(rankedByBand[bandName]);
    for (const donor of borrowOrder[bandName]) {
      if (picked.length === 2) break;
      const more = pickTwo(rankedByBand[donor].filter((o) => !picked.includes(o)));
      picked = [...picked, ...more].slice(0, 2);
    }
    results.push(...picked);
  }

  return results;
}
