import { CATEGORY_GROUP } from './categories';
import { isCompatibleCandidate, pairKey } from './pairs';
import type { CategoryGroup, ClothingItem } from '../types/wardrobe';

/**
 * Building complete outfits that meet today's weather bounds, from
 * candidates already fetched and category-filtered per slot.
 *
 * Pure and synchronous — no DB here. services/outfitGenerator.ts owns
 * fetching each slot's candidates; this file only searches the combinations.
 *
 * Bottom is a slot like any other, not a fixed input chosen ahead of time.
 * It used to be picked separately, by recency, before this search ever ran —
 * which meant no amount of ranking logic downstream could make it
 * weather-appropriate, because it was never weather-checked at all. Folding
 * it into the same lean-first, ceiling-checked search as Top and Shoes is
 * what actually fixes that: recency survives only as an emergent tie-break
 * (candidates already arrive newest-first from the DB, and leanFirst's sort
 * is stable), not as a rule that could override the weather.
 */

/**
 * Candidates offered per slot in a call to generateOutfits, each already
 * filtered to its group's categories and capped by the caller if needed.
 */
export interface OutfitCandidates {
  bottoms: readonly ClothingItem[];
  tops: readonly ClothingItem[];
  shoes: readonly ClothingItem[];
  outerwear: readonly ClothingItem[];
  scarves: readonly ClothingItem[];
  belts: readonly ClothingItem[];
  bags: readonly ClothingItem[];
}

/**
 * How many candidates a single slot considers.
 *
 * The search is a DFS over every slot's candidates, so this bounds it: with
 * seven slots this caps the worst case at MAX_SLOT_CANDIDATES^7 leaves,
 * which stays fast on-device for a personal wardrobe — and the ceiling check
 * prunes most of that in practice (see search()). A closet large enough for
 * this to matter needs candidates ranked and trimmed before generateOutfits
 * is called, not this constant raised.
 */
export const MAX_SLOT_CANDIDATES = 6;

/**
 * warmthFloor at or above which a Scarf is a required slot, not merely an
 * available one. Below it, a scarf is never offered — Scarf's role here is
 * specifically "required accessory for cold weather", not general styling.
 */
export const SCARF_REQUIRED_WARMTH_FLOOR = 7;

/** How many outfits generateOutfits returns by default. */
export const DEFAULT_MAX_OUTFITS = 3;

interface Slot {
  candidates: ClothingItem[];
  required: boolean;
}

function insulation(item: ClothingItem): number {
  return item.inferredWarmth + item.inferredWind;
}

/**
 * Ranks a slot's candidates lightest-first, then caps to MAX_SLOT_CANDIDATES.
 *
 * Without this, candidates arrive in "most recently added" order, which has
 * no relationship to the weather — a wool jumper bought last week sorts
 * before a t-shirt bought last year regardless of what today calls for. The
 * warmth floor is a floor, not a target to hit exactly, so trying the
 * lightest options first is the correct greedy direction: the search only
 * escalates to something warmer when the lean choice actually fails to
 * clear it. The sort is stable, so items with equal insulation keep their
 * incoming (newest-first) order — recency as a tie-break, not a rule.
 */
function leanFirst(items: readonly ClothingItem[]): ClothingItem[] {
  return [...items].sort((a, b) => insulation(a) - insulation(b)).slice(0, MAX_SLOT_CANDIDATES);
}

/**
 * Ranks a slot's candidates heaviest-first, then caps.
 *
 * Used only for Outerwear: it is the layer whose entire job in this search is
 * closing a warmth/wind gap the required slots didn't, so when it's needed at
 * all, the most effective piece is the one worth trying first rather than
 * last.
 */
function layerFirst(items: readonly ClothingItem[]): ClothingItem[] {
  return [...items].sort((a, b) => insulation(b) - insulation(a)).slice(0, MAX_SLOT_CANDIDATES);
}

function isDismatched(a: ClothingItem, b: ClothingItem, dismatchedKeys: ReadonlySet<string>): boolean {
  return dismatchedKeys.has(pairKey(a.id, b.id));
}

/**
 * Whether `candidate` can join an outfit that already contains `chosen`.
 *
 * Cold-start safe by construction: dismatchedKeys is expected to hold only
 * explicit DISMATCH rows (see services/items.ts's getDismatchedPairKeys), so
 * an unrated pair is never excluded here — only an explicit DISMATCH is.
 */
function isCompatibleWithAll(
  candidate: ClothingItem,
  chosen: readonly ClothingItem[],
  dismatchedKeys: ReadonlySet<string>,
): boolean {
  return chosen.every(
    (item) => isCompatibleCandidate(candidate, item) && !isDismatched(candidate, item, dismatchedKeys),
  );
}

/**
 * How much a body region's own warmth/wind score counts toward the outfit's
 * total, on top of whatever that item individually scores.
 *
 * The torso is where the body loses (or keeps) the most heat, and where wind
 * chill is felt most, so a Top/Outerwear/Dress item's score matters far more
 * to how warm the outfit actually is than a Shoes item's does — a warm
 * jacket and cold feet reads as "dressed for the weather"; a warm pair of
 * boots and a t-shirt in a snowstorm does not, no matter what the raw sum
 * says. Without this, every item counted equally regardless of where it
 * sits, which let a single well-insulated pair of boots offset a torso that
 * was nowhere near warm enough.
 *
 * Belt and Bag are listed for completeness even though their category ceiling
 * in utils/warmth.ts is 0 either way, so their weight can never matter.
 */
const REGION_WEIGHT: Record<CategoryGroup, number> = {
  Top: 1,
  Outerwear: 1,
  Dress: 1,
  Scarf: 0.8,
  Bottom: 0.6,
  Shoes: 0.25,
  Belt: 0.1,
  Bag: 0,
};

function weightOf(item: ClothingItem): number {
  return REGION_WEIGHT[CATEGORY_GROUP[item.category]];
}

function weightedSum(items: readonly ClothingItem[], key: 'inferredWarmth' | 'inferredWind'): number {
  return items.reduce((total, item) => total + item[key] * weightOf(item), 0);
}

/**
 * An outfit's total warmth, weighted by body region — exported for display
 * next to its target. Not a plain sum of inferredWarmth; see REGION_WEIGHT.
 */
export function sumWarmth(items: readonly ClothingItem[]): number {
  return weightedSum(items, 'inferredWarmth');
}

/** An outfit's total wind resistance, weighted by body region — see sumWarmth. */
export function sumWind(items: readonly ClothingItem[]): number {
  return weightedSum(items, 'inferredWind');
}

/**
 * The slots a search considers after the Bottom, in a fixed order, given
 * what this particular Bottom and today's weather need.
 */
function buildSlots(candidates: OutfitCandidates, needsScarf: boolean, needsBelt: boolean): Slot[] {
  return [
    { candidates: leanFirst(candidates.tops), required: true },
    { candidates: leanFirst(candidates.shoes), required: true },
    ...(needsScarf ? [{ candidates: leanFirst(candidates.scarves), required: true }] : []),
    ...(needsBelt ? [{ candidates: leanFirst(candidates.belts), required: true }] : []),
    { candidates: layerFirst(candidates.outerwear), required: false },
    { candidates: leanFirst(candidates.bags), required: false },
  ];
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
): ClothingItem[][] {
  const needsScarf = warmthFloor >= SCARF_REQUIRED_WARMTH_FLOOR;
  const results: ClothingItem[][] = [];
  const chosen: ClothingItem[] = [];

  function exceedsCeiling(): boolean {
    return sumWarmth(chosen) > warmthCeiling;
  }

  function searchSlots(slots: Slot[], slotIndex: number): void {
    if (results.length >= maxResults) return;

    if (slotIndex === slots.length) {
      if (sumWarmth(chosen) >= warmthFloor && sumWind(chosen) >= windFloor) {
        results.push([...chosen]);
      }
      return;
    }

    const slot = slots[slotIndex];
    if (!slot.required) searchSlots(slots, slotIndex + 1);

    for (const candidate of slot.candidates) {
      if (results.length >= maxResults) return;
      if (!isCompatibleWithAll(candidate, chosen, dismatchedKeys)) continue;
      chosen.push(candidate);
      if (!exceedsCeiling()) searchSlots(slots, slotIndex + 1);
      chosen.pop();
    }
  }

  for (const bottom of leanFirst(candidates.bottoms)) {
    if (results.length >= maxResults) return results;

    chosen.push(bottom);
    if (!exceedsCeiling()) {
      searchSlots(buildSlots(candidates, needsScarf, bottom.hasBeltLoops), 0);
    }
    chosen.pop();
  }

  return results;
}

/** A complete outfit alongside its computed totals and how they compare to the bounds. */
export interface ScoredOutfit {
  items: ClothingItem[];
  warmth: number;
  wind: number;
  /** Whether this outfit actually clears every bound — see generateOutfits. */
  meetsTarget: boolean;
}

/**
 * How far an outfit's totals sit from the bounds: 0 exactly at or inside
 * them, and rising with the worst single shortfall or overshoot. Used only to
 * rank candidates by closeness, so the exact scale doesn't matter — only the
 * ordering it produces.
 */
function distanceFromBounds(
  warmth: number,
  wind: number,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): number {
  return (
    Math.max(0, warmthFloor - warmth) + Math.max(0, warmth - warmthCeiling) + Math.max(0, windFloor - wind)
  );
}

/**
 * Every complete, compatible outfit the search space contains, ranked
 * closest-to-the-bounds first — for troubleshooting why generateOutfits found
 * nothing, not for recommending an outfit. Unlike generateOutfits, this does
 * not prune on the ceiling or stop at the first `maxResults` matches: leaving
 * either in place would hide the very outfits a "why didn't anything work"
 * question needs to see, and MAX_SLOT_CANDIDATES already bounds the search
 * space to something that stays fast without it (see its own doc comment).
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
): ScoredOutfit[] {
  const needsScarf = warmthFloor >= SCARF_REQUIRED_WARMTH_FLOOR;
  const all: ScoredOutfit[] = [];
  const chosen: ClothingItem[] = [];

  function searchSlots(slots: Slot[], slotIndex: number): void {
    if (slotIndex === slots.length) {
      const warmth = sumWarmth(chosen);
      const wind = sumWind(chosen);
      all.push({
        items: [...chosen],
        warmth,
        wind,
        meetsTarget: warmth >= warmthFloor && warmth <= warmthCeiling && wind >= windFloor,
      });
      return;
    }

    const slot = slots[slotIndex];
    if (!slot.required) searchSlots(slots, slotIndex + 1);

    for (const candidate of slot.candidates) {
      if (!isCompatibleWithAll(candidate, chosen, dismatchedKeys)) continue;
      chosen.push(candidate);
      searchSlots(slots, slotIndex + 1);
      chosen.pop();
    }
  }

  for (const bottom of leanFirst(candidates.bottoms)) {
    chosen.push(bottom);
    searchSlots(buildSlots(candidates, needsScarf, bottom.hasBeltLoops), 0);
    chosen.pop();
  }

  return all
    .sort(
      (a, b) =>
        distanceFromBounds(a.warmth, a.wind, warmthFloor, warmthCeiling, windFloor) -
        distanceFromBounds(b.warmth, b.wind, warmthFloor, warmthCeiling, windFloor),
    )
    .slice(0, maxResults);
}
