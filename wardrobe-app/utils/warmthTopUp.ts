import { sumWarmth, sumWind, meetsRegionFloors } from './outfitScoring';
import { SCARF_PREFERRED_WARMTH_FLOOR, tightsEligible } from './outfitSlots';
import { isCompatibleCandidate, pairKey } from './pairs';
import { recencyPenalty } from './outfitCandidatePools';
import type { OutfitCandidates, ScoredOutfit } from './outfitGenerator';
import type { WarmthBand } from './warmthBands';
import type { ClothingItem } from '../types/wardrobe';

/** Re-scores a candidate item set against the real bounds — the same shape scoreOutfit (outfitGenerator.ts) produces, kept local since that function isn't exported. */
function rescored(
  items: readonly ClothingItem[],
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): ScoredOutfit {
  const warmth = sumWarmth(items);
  const wind = sumWind(items);
  return {
    items: [...items],
    warmth,
    wind,
    meetsTarget:
      warmth >= warmthFloor && warmth <= warmthCeiling && wind >= windFloor && meetsRegionFloors(items, warmthFloor),
  };
}

function isCompatibleWithEveryItem(
  candidate: ClothingItem,
  chosen: readonly ClothingItem[],
  dismatchedKeys: ReadonlySet<string>,
): boolean {
  return chosen.every(
    (item) =>
      item.id !== candidate.id &&
      isCompatibleCandidate(candidate, item) &&
      !dismatchedKeys.has(pairKey(candidate.id, item.id)),
  );
}

/** The Bottom/Dress anchor among an outfit's own items — Tights eligibility is gated on the anchor's own category, same as buildSlots. */
function anchorOf(items: readonly ClothingItem[]): ClothingItem | undefined {
  return items.find(
    (item) =>
      item.category === 'Pants' ||
      item.category === 'Leggings' ||
      item.category === 'Skirt' ||
      item.category === 'Dress',
  );
}

/**
 * True if `a` is a strictly better top-up result than `b`. Fixing a failing
 * leg/torso region floor always wins over any whole-outfit warmth
 * consideration — Tights count toward legWarmth directly (see
 * outfitScoring.ts), so a top-up that turns a failing floor into a passing
 * one must never lose to one that merely sits closer to the band's center
 * while leaving the floor broken. Once floor-pass status is equal between
 * the two, closeness to band.center decides.
 */
function isBetterTopUp(a: ScoredOutfit, b: ScoredOutfit, band: WarmthBand, warmthFloor: number): boolean {
  const aFloorOk = meetsRegionFloors(a.items, warmthFloor);
  const bFloorOk = meetsRegionFloors(b.items, warmthFloor);
  if (aFloorOk !== bFloorOk) return aFloorOk;
  return Math.abs(a.warmth - band.center) < Math.abs(b.warmth - band.center);
}

/** Compatible-scarf/tights pools for one core outfit, independent of which band it's being topped up toward — see compatibleTopUpPools. */
export interface TopUpPools {
  scarves: readonly ClothingItem[];
  tights: readonly ClothingItem[];
}

/**
 * The scarves/tights from `candidates` that are compatible with `core`'s
 * existing items — the part of topUpToward's own work that doesn't depend
 * on which band it's being topped up toward, so a caller running
 * topUpToward for the same `core` against all three bands (selectBandedOutfits'
 * rankedForBand) can compute this once and reuse it three times instead of
 * repeating the same per-item compatibility filter for every band.
 */
export function compatibleTopUpPools(
  core: ScoredOutfit,
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
): TopUpPools {
  return {
    scarves: candidates.scarves.filter((s) => isCompatibleWithEveryItem(s, core.items, dismatchedKeys)),
    tights: candidates.tights.filter((t) => isCompatibleWithEveryItem(t, core.items, dismatchedKeys)),
  };
}

/**
 * The single addition from `pool` (added to `base`) that makes the best
 * top-up result per isBetterTopUp — not simply the warmest item, since the
 * warmest can overshoot band.center or warmthCeiling entirely. Searches the
 * *entire* pool, deliberately not pre-trimmed to a small candidate subset
 * (see topUpToward's own doc comment) — trimming to e.g. the lightest few
 * compatible items before this search would silently exclude the very item
 * a high band.center or a leg-floor fix actually needs. Ties (same
 * floor-pass status and gap, per isBetterTopUp) are broken by recency — the
 * less-recently-worn item wins, matching every other accessory slot in this
 * pipeline.
 */
function bestAddition(
  pool: readonly ClothingItem[],
  base: readonly ClothingItem[],
  band: WarmthBand,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  respectCeiling: boolean,
  wornDaysAgo: ReadonlyMap<string, number>,
): { item: ClothingItem; outfit: ScoredOutfit } | undefined {
  let best: { item: ClothingItem; outfit: ScoredOutfit } | undefined;
  for (const candidateItem of pool) {
    const outfit = rescored([...base, candidateItem], warmthFloor, warmthCeiling, windFloor);
    if (respectCeiling && outfit.warmth > warmthCeiling) continue;
    if (!best) {
      best = { item: candidateItem, outfit };
      continue;
    }
    if (isBetterTopUp(outfit, best.outfit, band, warmthFloor)) {
      best = { item: candidateItem, outfit };
    } else if (
      !isBetterTopUp(best.outfit, outfit, band, warmthFloor) &&
      recencyPenalty(candidateItem, wornDaysAgo) < recencyPenalty(best.item, wornDaysAgo)
    ) {
      // Neither strictly beats the other on floor-status/gap -- a genuine
      // tie, broken by recency.
      best = { item: candidateItem, outfit };
    }
  }
  return best;
}

/**
 * Adds a Scarf and/or Tights to `core` to close the gap toward `band.center`,
 * smallest addition first (Scarf alone, then Tights alone, then both) --
 * stopping as soon as the running total reaches band.center. Never removes
 * anything from `core.items`; returns `core` unchanged if it is already at
 * or past band.center *and* its region floors already pass, or if nothing
 * eligible and compatible improves on that.
 *
 * Also runs (Tights only -- Scarf never counts toward a region floor, see
 * outfitScoring.ts's WARMTH_REGION_WEIGHT) whenever `core` already meets
 * band.center but still fails a leg/torso region floor, since Tights can
 * turn a borderline leg-floor-failing core outfit into a passing one even
 * without needing more whole-outfit warmth -- see the design spec's
 * "Warmth top-up" section (docs/superpowers/specs/2026-09-01-today-banded-recommendations-design.md).
 *
 * Never pushes a `core` that was within warmthCeiling out past it -- a
 * top-up is a nudge, never a reason to disqualify an outfit that was
 * already valid.
 *
 * `wornDaysAgo`, when given, only breaks ties between otherwise
 * equally-good additions (see bestAddition) -- an equally-good top-up
 * prefers the less-recently-worn item, but recency never excludes an item
 * from consideration the way accessoryFirst's own cap-to-3 would.
 *
 * `pools`, when given, replaces this function's own compatible-scarf/tights
 * filtering (see compatibleTopUpPools) -- a caller running this for the
 * same `core` against multiple bands can compute it once and pass it in
 * every time, instead of repeating the same per-item compatibility check
 * once per band for a core-outfit list that can be uncapped (see
 * coreOutfitsForBands). Omitted, this filters `candidates` itself exactly
 * as before.
 */
export function topUpToward(
  core: ScoredOutfit,
  band: WarmthBand,
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  pools?: TopUpPools,
): ScoredOutfit {
  const needsWarmthBoost = core.warmth < band.center;
  const needsFloorFix = !meetsRegionFloors(core.items, warmthFloor);
  if (!needsWarmthBoost && !needsFloorFix) return core;

  const respectCeiling = core.warmth <= warmthCeiling;
  const anchor = anchorOf(core.items);
  // Scarf never counts toward a region floor (WARMTH_REGION_WEIGHT treats
  // it as whole-outfit only), so it's only ever worth trying for a warmth
  // boost, never purely to fix a floor.
  const scarfEligible = needsWarmthBoost && warmthFloor >= SCARF_PREFERRED_WARMTH_FLOOR;
  const tightsOk = anchor !== undefined && tightsEligible(anchor, warmthFloor) && (needsWarmthBoost || needsFloorFix);

  const compatiblePools = pools ?? compatibleTopUpPools(core, candidates, dismatchedKeys);
  const scarfCandidates = scarfEligible ? compatiblePools.scarves : [];
  const tightsCandidates = tightsOk ? compatiblePools.tights : [];

  const scarfPick = bestAddition(
    scarfCandidates,
    core.items,
    band,
    warmthFloor,
    warmthCeiling,
    windFloor,
    respectCeiling,
    wornDaysAgo,
  );
  const tightsPick = bestAddition(
    tightsCandidates,
    core.items,
    band,
    warmthFloor,
    warmthCeiling,
    windFloor,
    respectCeiling,
    wornDaysAgo,
  );

  const attempts: ScoredOutfit[] = [];
  if (scarfPick) attempts.push(scarfPick.outfit);
  if (tightsPick) attempts.push(tightsPick.outfit);
  if (scarfPick && tightsPick) {
    const both = rescored([...core.items, scarfPick.item, tightsPick.item], warmthFloor, warmthCeiling, windFloor);
    if (!respectCeiling || both.warmth <= warmthCeiling) attempts.push(both);
  }

  let best = core;
  for (const candidate of attempts) {
    if (isBetterTopUp(candidate, best, band, warmthFloor)) best = candidate;
    if (best.warmth >= band.center && meetsRegionFloors(best.items, warmthFloor)) break;
  }

  return best;
}
