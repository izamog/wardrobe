import { isCompatibleCandidate, pairKey } from './pairs';
import { CATEGORY_GROUP } from './categories';
import {
  accessoryFirst,
  baseLayerCandidates,
  baseTopCandidates,
  cardiganCandidates,
  excludesSleeveless,
  floorAwareCandidates,
  floorAwareOuterwearCandidates,
  shoeCandidatesFor,
  type OutfitCandidates,
} from './outfitCandidatePools';
import type { ClothingItem } from '../types/wardrobe';

/**
 * The ordered list of slots outfitGenerator.ts's search walks depth-first,
 * given an anchor (Bottom or Dress) and today's weather — and the shared
 * "try every candidate in a slot" loop both search functions there use.
 *
 * Split out of outfitGenerator.ts, which keeps the two search functions
 * themselves (generateOutfits/generateClosestOutfits) and the scoring they
 * compare leaves against; this file is about what a slot *is* and what order
 * they come in. What candidates end up inside each one lives in
 * outfitCandidatePools.ts.
 */

export type { OutfitCandidates } from './outfitCandidatePools';
export { MAX_SLOT_CANDIDATES, bottomCandidatesFor, floorAwareCandidates } from './outfitCandidatePools';

/**
 * warmthFloor at or above which a Scarf is offered as a preferred slot (tried
 * before being skipped — see the Slot.preferred doc comment). Below it, a
 * scarf is never offered at all.
 *
 * Not `required`: a wardrobe with no scarf (or none compatible with today's
 * outfit) used to make every branch fail outright once the floor crossed
 * this line, regardless of how many coats, boots or jumpers were available —
 * "required accessory for cold weather" turned into "no outfit exists at
 * all" for anyone who simply doesn't own a scarf. `preferred` keeps the same
 * bias toward adding one when the weather calls for it, without making its
 * absence fatal.
 */
export const SCARF_PREFERRED_WARMTH_FLOOR = 7;

/**
 * warmthFloor above which Tights are offered under a Pants/Leggings anchor,
 * as an extra cold-weather layer rather than legwear worn instead of a
 * Bottom (that role — under a Skirt or Dress — is gated on warmthFloor > 0
 * alone, no separate threshold; see buildSlots).
 *
 * A literal warmthFloor value, the same style as SCARF_PREFERRED_WARMTH_FLOOR
 * — tied to utils/thermal.ts's current calibration, not derived from it, so
 * it moves out of step if that calibration changes again. 18 is
 * warmthFloor(5°C) under the calibration this was set against: at 5°C and
 * above, ordinary trousers are adequate leg coverage on their own (see
 * LEG_WARMTH_FLOOR_FRACTION in outfitScoring.ts) and Tights under them read
 * as odd, not practical; colder than that, Tights-under-trousers is a real
 * layering habit worth offering.
 */
export const TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR = 18;

export interface Slot {
  candidates: ClothingItem[];
  required: boolean;
  /**
   * Optional, but tried before the skip branch rather than after — the slot
   * is included whenever some candidate is actually compatible with what's
   * chosen so far, and only left out when none is. Unlike `required`, an
   * empty result here does not kill the branch: styling preferences (a bag,
   * tights) should bias the search toward including them, not block an
   * otherwise-valid outfit just because this one has none that fits. See Bag
   * and Tights in buildSlots for the two slots that use this.
   */
  preferred?: boolean;
}

function isDismatched(a: ClothingItem, b: ClothingItem, dismatchedKeys: ReadonlySet<string>): boolean {
  return dismatchedKeys.has(pairKey(a.id, b.id));
}

/** Whether a slot's skip branch runs before its candidates — see the Slot.preferred doc comment. */
export function skipsBeforeCandidates(slot: Slot): boolean {
  return !slot.required && !slot.preferred;
}

/**
 * Whether `candidate` can join an outfit that already contains `chosen`.
 *
 * Cold-start safe by construction: dismatchedKeys is expected to hold only
 * explicit DISMATCH rows (see services/items.ts's getDismatchedPairKeys), so
 * an unrated pair is never excluded here — only an explicit DISMATCH is.
 *
 * The same physical item can never be worn twice — not a concern before the
 * Base Layer slot existed (see buildSlots), since every slot before it drew
 * from a disjoint category pool; Base Layer and the main Top slot both draw
 * from the Top group, so without this check the same T-Shirt could fill both
 * at once.
 *
 * A Cardigan sits over at most one other torso item, never a whole stack —
 * a Cardigan, Shirt and T-Shirt together is two layers underneath it, not
 * one. Cardigan's own slot already guarantees exactly one main Top/Dress
 * item; it's only the Base Layer slot (see baseLayerCandidates in
 * outfitCandidatePools.ts) that can add a second one alongside it, so this
 * only ever has anything to reject once both a Cardigan and a Base Layer
 * T-Shirt are in the running for the same outfit — a plain T-Shirt-only or
 * Shirt-only base under a Cardigan is unaffected.
 */
function violatesCardiganLayerLimit(candidate: ClothingItem, chosen: readonly ClothingItem[]): boolean {
  const combined = [...chosen, candidate];
  if (!combined.some((item) => item.category === 'Cardigan')) return false;
  const nonCardiganTorsoItems = combined.filter(
    (item) =>
      item.category !== 'Cardigan' &&
      (CATEGORY_GROUP[item.category] === 'Top' || CATEGORY_GROUP[item.category] === 'Dress'),
  );
  return nonCardiganTorsoItems.length > 1;
}

function isCompatibleWithAll(
  candidate: ClothingItem,
  chosen: readonly ClothingItem[],
  dismatchedKeys: ReadonlySet<string>,
): boolean {
  if (violatesCardiganLayerLimit(candidate, chosen)) return false;
  return chosen.every(
    (item) =>
      item.id !== candidate.id &&
      isCompatibleCandidate(candidate, item) &&
      !isDismatched(candidate, item, dismatchedKeys),
  );
}

/**
 * Tries every compatible candidate in a slot, recursing into `wear` for each
 * one `isViable` still allows. Shared between generateOutfits and
 * generateClosestOutfits' own searchSlots so neither has to repeat this loop
 * — pulled out mainly to keep both under the project's complexity/length
 * lint budget, but it also means the two search flavours can never quietly
 * drift apart on what "try a candidate" means.
 *
 * A preferred slot's skip branch (see Slot.preferred and buildSlots) always
 * runs in addition to this, regardless of whether a candidate here led
 * anywhere — earlier this loop tried to decide the skip branch was
 * unnecessary whenever *some* candidate led to *any* complete, valid outfit
 * anywhere further down the search, which silently discarded entire
 * genuinely different outfits that never wore the accessory at all (a jacket
 * added instead of a scarf, say), not just the literal duplicate the check
 * was meant to catch. Preferring the accessorized version of the *same*
 * outfit over its bare twin is instead handled after the fact, on the
 * complete result sets — see outfitDedup.ts's dropAccessoryFreeDuplicates.
 *
 * `isViable` gates whether `wear` is even called: in generateOutfits it's
 * the ceiling check, pruning a branch that provably cannot succeed (warmth
 * is monotonic non-decreasing — see generateOutfits' own doc comment)
 * rather than wasting a recursive call finding that out. generateClosestOutfits
 * passes `() => true` — nothing is pruned there, since that view exists to
 * show near-misses, not hide them.
 */
export function tryEachCandidate(
  slot: Slot,
  chosen: ClothingItem[],
  dismatchedKeys: ReadonlySet<string>,
  isDone: () => boolean,
  isViable: () => boolean,
  wear: () => void,
): void {
  for (const candidate of slot.candidates) {
    if (isDone()) return;
    if (!isCompatibleWithAll(candidate, chosen, dismatchedKeys)) continue;
    chosen.push(candidate);
    if (isViable()) wear();
    chosen.pop();
  }
}

/** Whether this anchor is a Dress — see OutfitCandidates.bottoms. */
function isDressAnchor(anchor: ClothingItem): boolean {
  return anchor.category === 'Dress';
}

/** Whether Tights are offered under this anchor at all — the exact condition buildSlots already gates its own Tights slot on, pulled out so warmthTopUp.ts can reuse it. */
export function tightsEligible(anchor: ClothingItem, warmthFloor: number): boolean {
  const isDress = isDressAnchor(anchor);
  const isTrousers = anchor.category === 'Pants' || anchor.category === 'Leggings';
  return (
    warmthFloor > 0 &&
    ((isDress || anchor.category === 'Skirt') || (isTrousers && warmthFloor > TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR))
  );
}

/**
 * The slots a search considers after the anchor (Bottom or Dress), in a
 * fixed order, given what this particular anchor and today's weather need.
 *
 * A Top is required to complete an outfit built around a Pants/Leggings/Skirt
 * anchor, but not around a Dress — a Dress already covers the torso on its
 * own, and a T-Shirt/Shirt/Cardigan/Sweater layered with it (see
 * utils/layering.ts) is an option, not a requirement.
 *
 * Bag, Tights and Scarf are all `preferred`, not `required` — see the
 * SCARF_PREFERRED_WARMTH_FLOOR doc comment for why Scarf moved out of
 * `required`. A bag belongs with almost any outfit, so it's tried before
 * being skipped rather than after, and none of the three is a real
 * constraint: a branch where no compatible one exists still produces an
 * outfit, just without it, rather than failing outright. Tights enter the
 * pool at all only when the closet has some and warmthFloor calls for some
 * extra warmth (warmthFloor > 0, the same cutoff shoeCandidatesFor uses to
 * drop Sandals) — without that check, tights were offered regardless of
 * temperature, and being `preferred` (tried before being skipped) meant a
 * compatible pair got added even on a warm day a bare-legged skirt was
 * perfectly appropriate for. Under a Skirt or Dress that's the whole
 * condition; under Pants or Leggings, Tights are also gated on
 * TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR, below — an ordinary pair of trousers
 * is already adequate leg coverage on its own at an everyday cool
 * temperature (see LEG_WARMTH_FLOOR_FRACTION in outfitScoring.ts), and
 * layering tights underneath is a real cold-weather habit, not an
 * everyday-cool one.
 *
 * Cardigan is split out of the Top slot's own pool (see baseTopCandidates in
 * outfitCandidatePools.ts) into its own slot, always optional and placed
 * right after Top: a Cardigan is layered over a real base, never worn as the
 * torso's only covering, and a Dress anchor already provides that base on
 * its own even when the (still-optional) Top slot is skipped. Which bases a
 * Cardigan may actually pair with is enforced where every other pairwise
 * rule is — clearsCardiganLayerRule in pairs.ts — not here.
 *
 * Base Layer is the same idea one step further in: an optional T-Shirt worn
 * *underneath* whatever fills Top, not an alternative to it (see
 * baseLayerCandidates) — the search previously could only ever pick one Top
 * item, so it had no way to add a thermal or a tee under a Sweater or Shirt
 * for extra warmth even when the closet had one.
 *
 * Shoes is filtered by warmthFloor before it ever reaches the slot — see
 * shoeCandidatesFor (outfitCandidatePools.ts) — and, like Top and the
 * Bottom/Dress anchor, kept both-ends floor-aware (floorAwareCandidates)
 * rather than lightest-only: unlike every slot below, Shoes is required, so
 * a lightest-only pool could exclude the only boots warm enough to clear the
 * leg-region floor and fail every branch of the search outright, not just
 * miss out on one optional layer — the same failure mode a required Bottom
 * or Top pool would have, and reported the same way ("no outfits at all") at
 * exactly the cold end of the temperature range floorAwareCandidates was
 * never applied to it. Scarf, Belt, Tights, Bag, Cardigan and Base Layer are
 * capped at MAX_ACCESSORY_CANDIDATES there, not MAX_SLOT_CANDIDATES — see
 * that constant's doc comment for why a wider pool there only multiplies the
 * search without ever changing whether an outfit is weather-appropriate.
 */
export function buildSlots(
  candidates: OutfitCandidates,
  anchor: ClothingItem,
  warmthFloor: number,
  needsScarf: boolean,
  needsBelt: boolean,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  options: { includeWarmthAccessories?: boolean; topCandidatesOverride?: readonly ClothingItem[]; warmthCeiling?: number } = {},
): Slot[] {
  const { includeWarmthAccessories = true, topCandidatesOverride, warmthCeiling } = options;
  const isDress = isDressAnchor(anchor);
  const offerTights = includeWarmthAccessories && tightsEligible(anchor, warmthFloor);
  const offerScarf = includeWarmthAccessories && needsScarf;

  return [
    {
      candidates: topCandidatesOverride
        ? [...topCandidatesOverride]
        : floorAwareCandidates(baseTopCandidates(candidates.tops, warmthFloor), warmthFloor, wornDaysAgo, warmthCeiling),
      required: !isDress,
    },
    { candidates: accessoryFirst(cardiganCandidates(candidates.tops, warmthFloor), wornDaysAgo), required: false },
    { candidates: accessoryFirst(baseLayerCandidates(candidates.tops, warmthFloor), wornDaysAgo), required: false },
    {
      candidates: floorAwareCandidates(shoeCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo, warmthCeiling),
      required: true,
    },
    ...(offerScarf
      ? [{ candidates: accessoryFirst(candidates.scarves, wornDaysAgo), required: false, preferred: true }]
      : []),
    ...(needsBelt ? [{ candidates: accessoryFirst(candidates.belts, wornDaysAgo), required: true }] : []),
    ...(offerTights
      ? [{ candidates: accessoryFirst(candidates.tights, wornDaysAgo), required: false, preferred: true }]
      : []),
    {
      candidates: floorAwareOuterwearCandidates(excludesSleeveless(candidates.outerwear, warmthFloor), wornDaysAgo),
      required: false,
    },
    { candidates: accessoryFirst(candidates.bags, wornDaysAgo), required: false, preferred: true },
  ];
}
