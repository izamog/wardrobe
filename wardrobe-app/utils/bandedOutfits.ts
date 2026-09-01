import { floorAwareCandidates, bottomCandidatesFor, baseTopCandidates } from './outfitCandidatePools';
import { generateClosestOutfits, type OutfitCandidates, type ScoredOutfit } from './outfitGenerator';
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
