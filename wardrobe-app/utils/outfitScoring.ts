import { CATEGORY_GROUP } from './categories';
import type { CategoryGroup, ClothingItem } from '../types/wardrobe';

/**
 * Turning a set of chosen items into the warmth/wind totals and per-region
 * checks outfitGenerator.ts's search compares against today's bounds.
 *
 * Pure math only — no candidates, no slots, no search. Split out of
 * outfitGenerator.ts so that file stays about the search itself; this one is
 * about what a "warm enough" or "region-appropriate" outfit even means.
 */

/**
 * How much a body region's own warmth score counts toward the outfit's
 * total, on top of whatever that item individually scores.
 *
 * The torso is where the body loses (or keeps) the most heat, so a
 * Top/Outerwear/Dress item's score matters far more to how warm the outfit
 * actually is than a Shoes item's does — a warm jacket and cold feet reads
 * as "dressed for the weather"; a warm pair of boots and a t-shirt in a
 * snowstorm does not, no matter what the raw sum says. Without this, every
 * item counted equally regardless of where it sits, which let a single
 * well-insulated pair of boots offset a torso that was nowhere near warm
 * enough.
 *
 * Shoes weighted at 0, not just down-weighted: user feedback was that
 * footwear shouldn't count toward "how warm is this outfit" at all — it
 * should be picked appropriately for the weather (no sandals in a cold
 * snap), not treated as a source of warmth the rest of the outfit can lean
 * on. That weather-appropriateness is a *separate* mechanism from this
 * table: a required Shoes slot is already filtered by its own warmth floor
 * in outfitCandidatePools.ts's shoeCandidatesFor/floorAwareCandidates, so
 * setting this weight to 0 only removes Shoes' ability to help an outfit
 * clear the *overall* warmth floor via the summed total — cold-weather
 * footwear selection itself is unaffected.
 *
 * Belt and Bag are listed for completeness even though their category ceiling
 * in utils/warmth.ts is 0 either way, so their weight can never matter.
 *
 * Tights sits below Bottom's own weight: it is a thin layer added on top of
 * a Skirt or Dress rather than the leg's primary covering, closer in role to
 * Scarf-on-torso than to a Bottom in its own right.
 */
const WARMTH_REGION_WEIGHT: Record<CategoryGroup, number> = {
  Top: 1,
  Outerwear: 1,
  Dress: 1,
  Scarf: 0.8,
  Bottom: 0.6,
  Shoes: 0,
  Belt: 0.1,
  Bag: 0,
  Tights: 0.15,
};

/**
 * How much a body region's own wind score counts toward the outfit's total.
 *
 * A narrower list than WARMTH_REGION_WEIGHT, and deliberately so: outerwear,
 * a bottom (or Dress, which covers the same leg area) and a scarf are the
 * pieces that actually shield the body from moving air. A T-Shirt or a pair
 * of trainers can each carry a real inferredWind score of their own (see
 * utils/warmth.ts — a closed shoe blocks a draft at the ankle), but that
 * score describes the *garment's* construction, not how much it does for the
 * wearer's overall exposure the way a torso or leg layer does — a Sandals
 * item scores 0 either way (see CATEGORY_RANGE), so weighting Shoes at all
 * only ever inflated a wind total that shouldn't have counted a warm jacket
 * as "windproof enough" while a bare-legged skirt and open sandals sat right
 * alongside it contributing nothing of their own but also costing nothing.
 * Categories absent here score 0, same as Belt/Bag already did for warmth.
 */
const WIND_REGION_WEIGHT: Partial<Record<CategoryGroup, number>> = {
  Outerwear: 1,
  Bottom: 0.6,
  Dress: 0.6,
  Scarf: 0.8,
};

function weightedSum(
  items: readonly ClothingItem[],
  key: 'inferredWarmth' | 'inferredWind',
  weights: Partial<Record<CategoryGroup, number>>,
): number {
  return items.reduce((total, item) => total + item[key] * (weights[CATEGORY_GROUP[item.category]] ?? 0), 0);
}

/**
 * An outfit's total warmth, weighted by body region — exported for display
 * next to its target. Not a plain sum of inferredWarmth; see WARMTH_REGION_WEIGHT.
 */
export function sumWarmth(items: readonly ClothingItem[]): number {
  return weightedSum(items, 'inferredWarmth', WARMTH_REGION_WEIGHT);
}

/**
 * An outfit's total wind resistance — only outerwear, a bottom/Dress and a
 * scarf count; see WIND_REGION_WEIGHT.
 */
export function sumWind(items: readonly ClothingItem[]): number {
  return weightedSum(items, 'inferredWind', WIND_REGION_WEIGHT);
}

/**
 * The combined warmth of the leg region alone — a Bottom/Dress plus any
 * Tights layered on top — unweighted by WARMTH_REGION_WEIGHT, which exists to
 * compare against the *outfit's* floor, not this region's own bar.
 *
 * Backs meetsLegFloor: an outfit's total can clear warmthFloor on the
 * strength of a warm jacket alone while the bottom itself is a bare-legged
 * mini skirt with sandals — mathematically warm enough, but not what a
 * person dressed that way is actually wearing on their legs. See
 * REGION_WARMTH_FLOOR_FRACTION.
 */
export function legWarmth(items: readonly ClothingItem[]): number {
  return items.reduce((total, item) => {
    const group = CATEGORY_GROUP[item.category];
    return group === 'Bottom' || group === 'Dress' || group === 'Tights' ? total + item.inferredWarmth : total;
  }, 0);
}

/**
 * The combined warmth of the torso region alone — a Top or Dress —
 * deliberately excluding Outerwear for the same reason legWarmth excludes it:
 * see meetsTorsoFloor.
 */
export function torsoWarmth(items: readonly ClothingItem[]): number {
  return items.reduce((total, item) => {
    const group = CATEGORY_GROUP[item.category];
    return group === 'Top' || group === 'Dress' ? total + item.inferredWarmth : total;
  }, 0);
}

/**
 * The fraction of the outfit's overall warmthFloor the torso region (Top or
 * Dress) must clear on its own.
 *
 * 1/3, not 1.0: the torso is not meant to single-handedly carry the *whole*
 * floor — it's deliberately allowed some help from a layer on top of it (see
 * WARMTH_REGION_WEIGHT — Top counts at full weight, but a
 * Cardigan/Sweater/Jacket/Coat all add their own warmth too), so demanding
 * it hit the entire floor alone would reject perfectly reasonable outfits (a
 * warm jumper over lighter trousers). What this rules out is a torso scoring
 * at or near 0 — a sleeveless or thin top — riding along on a warm jacket's
 * coattails while contributing nothing of its own.
 */
export const TORSO_WARMTH_FLOOR_FRACTION = 1 / 3;

/**
 * The fraction of the outfit's overall warmthFloor the leg region (Bottom or
 * Dress, plus Tights) must clear on its own.
 *
 * A separate, lower fraction than TORSO_WARMTH_FLOOR_FRACTION: unlike the
 * torso, an ordinary pair of trousers has no everyday extra layer to lean
 * on the way a Cardigan or Jacket helps the torso — Tights are the only
 * thing that can add to a Pants/Leggings anchor's own leg warmth, and (see
 * offerTights in outfitSlots.ts) they're only ever offered under trousers
 * once it's genuinely cold, not at an everyday cool temperature. 1/3 (the
 * same fraction as the torso) rejected ordinary denim jeans at 5°C on their
 * own — a reported false negative, since jeans alone are real, adequate leg
 * coverage right up to the point Tights are meant to start layering under
 * them. 1/4 is what a pair of jeans (see the worked example in
 * services/__tests__/outfitGenerator.test.ts) clears at that temperature
 * without Tights, while a Mini skirt or Shorts — near 0 on their own — still
 * do not, with or without this fraction.
 */
export const LEG_WARMTH_FLOOR_FRACTION = 1 / 4;

/**
 * The real per-item weight a Bottom/Dress item's inferredWarmth carries
 * toward an outfit's total weighted warmth (see WARMTH_REGION_WEIGHT and
 * sumWarmth above) -- exported so mergedByBandCenters (bandedOutfits.ts) can
 * scale a day's warmthCeiling down to the same raw, per-item scale
 * floorAwareCandidates' ceiling filter compares against, without reusing
 * LEG_WARMTH_FLOOR_FRACTION (a floor-apportionment constant with no ceiling
 * meaning -- reusing it for the ceiling was the reported bug this fixes: a
 * raw-warmth-4 bottom was excluded by a ceiling scaled to 1.5 when its real
 * weighted contribution, 4 * 0.6 = 2.4, was well under the day's actual
 * ceiling of 6).
 */
export const LEG_WARMTH_CEILING_WEIGHT = WARMTH_REGION_WEIGHT.Bottom;

/** Same as LEG_WARMTH_CEILING_WEIGHT, for the Top region -- see that constant's doc comment. */
export const TORSO_WARMTH_CEILING_WEIGHT = WARMTH_REGION_WEIGHT.Top;

/** Whether the leg region alone is warm enough for today, given the outfit's warmthFloor — see legWarmth. */
function meetsLegFloor(chosen: readonly ClothingItem[], warmthFloor: number): boolean {
  return legWarmth(chosen) >= warmthFloor * LEG_WARMTH_FLOOR_FRACTION;
}

/**
 * Whether the torso region alone is warm enough for today, given the
 * outfit's warmthFloor — see torsoWarmth.
 *
 * Outerwear does not count toward this: a warm coat genuinely does insulate
 * the torso, but an outfit that relies on the coat alone to make a
 * sleeveless or unlined top "work" is not weather-appropriate the moment the
 * coat comes off indoors, in a car, or over the course of a warming day —
 * the reported bug was exactly this, a 0-warmth top paired with a 10-warmth
 * coat clearing the outfit's total on the coat's strength alone.
 */
function meetsTorsoFloor(chosen: readonly ClothingItem[], warmthFloor: number): boolean {
  return torsoWarmth(chosen) >= warmthFloor * TORSO_WARMTH_FLOOR_FRACTION;
}

/** Whether both the leg and torso regions are independently warm enough — see meetsLegFloor/meetsTorsoFloor. */
export function meetsRegionFloors(chosen: readonly ClothingItem[], warmthFloor: number): boolean {
  return meetsLegFloor(chosen, warmthFloor) && meetsTorsoFloor(chosen, warmthFloor);
}

/**
 * How far below its own per-region floor the leg and torso regions
 * currently sit, summed. Used only by distanceFromBounds so that an outfit
 * failing a region floor never ranks as "distance 0" alongside one that
 * genuinely meets every bound — without this, generateClosestOutfits' sort
 * couldn't tell a region-floor violation apart from a real match, and the
 * violation could sort first purely because its bottom happened to be tried
 * first (see floorAwareCandidates' warmthFloor<=0 branch in
 * outfitCandidatePools.ts).
 */
function regionShortfall(chosen: readonly ClothingItem[], warmthFloor: number): number {
  const legTarget = warmthFloor * LEG_WARMTH_FLOOR_FRACTION;
  const torsoTarget = warmthFloor * TORSO_WARMTH_FLOOR_FRACTION;
  return Math.max(0, legTarget - legWarmth(chosen)) + Math.max(0, torsoTarget - torsoWarmth(chosen));
}

/**
 * How far an outfit's totals sit from the bounds: 0 exactly at or inside
 * them, and rising with the worst single shortfall or overshoot. Used only to
 * rank candidates by closeness, so the exact scale doesn't matter — only the
 * ordering it produces.
 */
export function distanceFromBounds(
  chosen: readonly ClothingItem[],
  warmth: number,
  wind: number,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): number {
  return (
    Math.max(0, warmthFloor - warmth) +
    Math.max(0, warmth - warmthCeiling) +
    Math.max(0, windFloor - wind) +
    regionShortfall(chosen, warmthFloor)
  );
}
