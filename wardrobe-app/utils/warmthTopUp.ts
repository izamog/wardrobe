import { sumWarmth, sumWind, meetsRegionFloors } from './outfitScoring';
import { SCARF_PREFERRED_WARMTH_FLOOR, tightsEligible } from './outfitSlots';
import { isCompatibleCandidate, pairKey } from './pairs';
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
  return items.find((item) => item.category === 'Pants' || item.category === 'Leggings' || item.category === 'Skirt' || item.category === 'Dress');
}

/**
 * Adds a Scarf and/or Tights to `core` to close the gap toward `band.center`,
 * smallest addition first (Scarf alone, then Tights alone, then both) --
 * stopping as soon as the running total reaches band.center. Never removes
 * anything from `core.items`; returns `core` unchanged if it is already at
 * or past band.center, or if nothing eligible and compatible closes any of
 * the gap. See the design spec's "Warmth top-up" section for the full
 * reasoning (docs/superpowers/specs/2026-09-01-today-banded-recommendations-design.md).
 */
export function topUpToward(
  core: ScoredOutfit,
  band: WarmthBand,
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): ScoredOutfit {
  if (core.warmth >= band.center) return core;

  const anchor = anchorOf(core.items);
  const scarfEligible = warmthFloor >= SCARF_PREFERRED_WARMTH_FLOOR;
  const tightsOk = anchor !== undefined && tightsEligible(anchor, warmthFloor);

  const scarfCandidates = scarfEligible
    ? candidates.scarves.filter((s) => isCompatibleWithEveryItem(s, core.items, dismatchedKeys))
    : [];
  const tightsCandidates = tightsOk
    ? candidates.tights.filter((t) => isCompatibleWithEveryItem(t, core.items, dismatchedKeys))
    : [];

  const closestBy = (pool: readonly ClothingItem[]): ClothingItem | undefined =>
    [...pool].sort((a, b) => Math.abs(a.inferredWarmth - 0) - Math.abs(b.inferredWarmth - 0)).length > 0
      ? [...pool].sort((a, b) => b.inferredWarmth - a.inferredWarmth)[0]
      : undefined;

  const scarf = closestBy(scarfCandidates);
  const tights = closestBy(tightsCandidates);

  const attempts: ClothingItem[][] = [];
  if (scarf) attempts.push([scarf]);
  if (tights) attempts.push([tights]);
  if (scarf && tights) attempts.push([scarf, tights]);

  let best = core;
  for (const addition of attempts) {
    const candidate = rescored([...core.items, ...addition], warmthFloor, warmthCeiling, windFloor);
    const bestGap = Math.abs(best.warmth - band.center);
    const candidateGap = Math.abs(candidate.warmth - band.center);
    if (candidateGap < bestGap) best = candidate;
    if (best.warmth >= band.center) break;
  }

  return best;
}
