import type { ClothingItem } from '../types/wardrobe';

/**
 * Turning each raw candidate list a caller fetched into the ordered,
 * weather-filtered, size-bounded pool a single outfit slot actually searches
 * over.
 *
 * Split out of outfitSlots.ts, which keeps Slot itself and buildSlots (what
 * slots exist and in what order); this file is about what candidates end up
 * inside each one.
 */

/**
 * Candidates offered per slot in a call to generateOutfits, each already
 * filtered to its group's categories and capped by the caller if needed.
 */
export interface OutfitCandidates {
  /**
   * The search's anchor slot — every Bottom-group category (Pants, Leggings,
   * Skirt) *and* every Dress, merged into one pool. A Dress fills the same
   * anchor role a Bottom does (see the module doc comment on Bottom), so it
   * belongs in the same slot rather than a separate one the search would
   * additionally have to consider — see isDressAnchor in outfitSlots.ts for
   * the one place that distinction still matters.
   */
  bottoms: readonly ClothingItem[];
  tops: readonly ClothingItem[];
  shoes: readonly ClothingItem[];
  outerwear: readonly ClothingItem[];
  scarves: readonly ClothingItem[];
  belts: readonly ClothingItem[];
  bags: readonly ClothingItem[];
  tights: readonly ClothingItem[];
}

/**
 * How many candidates the Top slot or the Bottom/Dress anchor considers.
 *
 * The search is a DFS over every slot's candidates, so this bounds it: with
 * seven slots this caps the worst case at MAX_SLOT_CANDIDATES^7 leaves,
 * which stays fast on-device for a personal wardrobe — and the ceiling check
 * prunes most of that in practice (see generateOutfits). A closet large
 * enough for this to matter needs candidates ranked and trimmed before
 * generateOutfits is called, not this constant raised.
 */
export const MAX_SLOT_CANDIDATES = 6;

/**
 * How many candidates a purely-optional accessory slot (Scarf, Belt, Bag,
 * Tights, Outerwear) considers — smaller than MAX_SLOT_CANDIDATES because,
 * unlike Top or the Bottom/Dress anchor, none of these can single-handedly
 * make an otherwise-failing outfit clear a region floor (see
 * outfitScoring.ts's meetsLegFloor/meetsTorsoFloor), so trying more of them
 * only multiplies the search without ever finding an outfit the wider Top/
 * Bottom pool couldn't. Every one of these slots is `preferred` or plain
 * optional, both of which explore their skip branch *in addition to* every
 * candidate (see tryEachCandidate and skipsBeforeCandidates in
 * outfitSlots.ts) — with five such slots, MAX_SLOT_CANDIDATES-sized pools
 * compound into millions of leaves on a cold, accessorized outfit; this
 * constant is what keeps that bounded without narrowing Top or Bottom, where
 * a small pool was exactly what caused a wardrobe with many light options to
 * never try a warm one at all.
 */
const MAX_ACCESSORY_CANDIDATES = 3;

function insulation(item: ClothingItem): number {
  return item.inferredWarmth + item.inferredWind;
}

/**
 * 0 (never worn / worn 30+ days ago) up to RECENCY_PENALTY_MAX (worn very
 * recently), graduated across the 7/14/30-day bands the user described --
 * see the design spec's "Recency penalty function" section. Added to
 * insulation() by scoreFor so a recently-worn item ranks slightly behind an
 * equally-warm alternative -- it may reorder items whose insulation differs
 * by up to RECENCY_PENALTY_MAX, but never crosses a larger real
 * weather-fitness gap (see compareByScore).
 */
const RECENCY_PENALTY_MAX = 3;

export function recencyPenalty(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number {
  const daysAgo = wornDaysAgo.get(item.id);
  if (daysAgo === undefined) return 0;
  if (daysAgo < 7) return RECENCY_PENALTY_MAX;
  if (daysAgo < 14) return RECENCY_PENALTY_MAX * (2 / 3);
  if (daysAgo < 30) return RECENCY_PENALTY_MAX * (1 / 3);
  return 0;
}

/** insulation() plus recencyPenalty() -- the single number every candidate-pool sort in this file ranks by, once wornDaysAgo is known. */
export function scoreFor(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number {
  return insulation(item) + recencyPenalty(item, wornDaysAgo);
}

/**
 * Sorts two candidates by scoreFor, ascending (lighter/less-recently-worn
 * first, matching insulation()'s existing sort direction). A plain,
 * deterministic comparator safe for use in Array.prototype.sort — ties
 * keep input order (stable sort). Randomization for fair rotation across
 * ties is handled separately by rankWithFairTiebreak.
 *
 * The recency component may reorder items whose insulation differs by up to
 * RECENCY_PENALTY_MAX, but never crosses a larger real weather-fitness gap.
 */
export function compareByScore(a: ClothingItem, b: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number {
  return scoreFor(a, wornDaysAgo) - scoreFor(b, wornDaysAgo);
}

/**
 * A direction-aware rank key: ascending by this always puts the desired
 * ordering first, and — unlike flipping compareByScore's comparison order —
 * always biases a recently-worn item *later*, regardless of direction.
 *
 * compareByScore can't be reused directly for descending mode: flipping its
 * comparator argument order also flips the sign of recencyPenalty's
 * contribution, which would make a recently-worn item rank *earlier* in a
 * heaviest-first pool -- the opposite of the intended "recently-worn ranks
 * slightly behind an equally-warm alternative." Negating only insulation()
 * for descending mode, while always adding the (unnegated) penalty, keeps
 * that bias correct in both directions.
 */
function rankKey(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>, descending: boolean): number {
  const penalty = recencyPenalty(item, wornDaysAgo);
  return descending ? -insulation(item) + penalty : insulation(item) + penalty;
}

/**
 * Sorts by rankKey (stable -- ties keep input order), then shuffles each
 * contiguous run of exactly-tied items in place. A plain comparator alone
 * can't safely randomize -- Array.prototype.sort requires a comparator
 * that's consistent across repeated calls for the same pair, and a fresh
 * Math.random() result per call breaks that, risking an invalid ordering
 * once 3+ items tie. Shuffling only within already-adjacent tied runs,
 * after a valid stable sort, delivers the same fair-rotation goal without
 * that hazard.
 */
export function rankWithFairTiebreak(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number>,
  descending?: boolean,
): ClothingItem[] {
  const dir = descending ?? false;
  const sorted = [...items].sort((a, b) => rankKey(a, wornDaysAgo, dir) - rankKey(b, wornDaysAgo, dir));
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && rankKey(sorted[j], wornDaysAgo, dir) === rankKey(sorted[i], wornDaysAgo, dir)) j++;
    for (let k = j - 1; k > i; k--) {
      const r = i + Math.floor(Math.random() * (k - i + 1));
      [sorted[k], sorted[r]] = [sorted[r], sorted[k]];
    }
    i = j;
  }
  return sorted;
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
export function leanFirst(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  return rankWithFairTiebreak(items, wornDaysAgo).slice(0, MAX_SLOT_CANDIDATES);
}

/** Ranks a purely-optional accessory slot's candidates lightest-first, capped at MAX_ACCESSORY_CANDIDATES — see its doc comment. */
export function accessoryFirst(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  return rankWithFairTiebreak(items, wornDaysAgo).slice(0, MAX_ACCESSORY_CANDIDATES);
}

/**
 * Ranks a slot's candidates heaviest-first, then caps at
 * MAX_ACCESSORY_CANDIDATES.
 *
 * Not used directly for Outerwear any more — see floorAwareOuterwearCandidates,
 * which wraps this and adds the single leanest option on top, below — but
 * kept as the building block for it and exported for tests.
 */
export function layerFirst(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  return rankWithFairTiebreak(items, wornDaysAgo, true).slice(0, MAX_ACCESSORY_CANDIDATES);
}

/**
 * Selects up to MAX_SLOT_CANDIDATES candidates for the Top slot or the
 * Bottom/Dress anchor, split between the leanest options overall and the
 * warmest options overall.
 *
 * leanFirst's blind "N lightest overall" selection silently dropped every
 * weather-appropriate item once a wardrobe held MAX_SLOT_CANDIDATES or more
 * lighter ones — a wool sweater or a pair of jeans never entered the search
 * at all on a cold day if the closet had six lighter tops or bottoms
 * (t-shirts, shorts, summer skirts), regardless of what the weather called
 * for; the DFS could only ever find combinations of whatever leanFirst
 * happened to keep. This keeps that same greedy "leanest that still works"
 * bias — a candidate here is not a guarantee, just a starting point the
 * search still weather-checks in full — while guaranteeing the pool always
 * includes this group's warmest available options too, when the closet has
 * them.
 *
 * Earlier, the warm half was picked by filtering for
 * `item.inferredWarmth >= warmthFloor * LEG_WARMTH_FLOOR_FRACTION` — that
 * threshold checks a Bottom item's own warmth alone against a target that,
 * at extreme cold, can exceed the highest warmth *any* Pants or Skirt can
 * reach on its own (CATEGORY_RANGE's per-category max in utils/warmth.ts),
 * since real leg warmth is bottom-plus-Tights (see legWarmth in
 * outfitScoring.ts), not the bottom alone. Once the target passed that
 * ceiling, the filter matched nothing, silently collapsing this back to
 * plain leanFirst — every bottom offered was one of the lightest in the
 * closet, denim or wool trousers never included at all, however cold it got.
 * Picking "warmest available" outright, with no threshold to clear, has no
 * such cliff: the search always gets to try the wardrobe's actual warmest
 * options, whether or not they alone would clear a region floor that may
 * need a Tights layer (chosen in a later slot) to fully close.
 *
 * At warmthFloor 0 there is nothing to stay warm against, so this is exactly
 * leanFirst.
 *
 * Reported bug: a bottom sitting between the leanest and warmest thirds —
 * often the actual best fit for today, closest to (or just clearing) the
 * floor without being wastefully over-warm — was silently invisible to the
 * search whenever the wardrobe had more than MAX_SLOT_CANDIDATES options
 * spread across that range: leanFirst's own N-lightest slice and the
 * warmest-N slice can both miss it entirely, in which case nothing else
 * here ever offered it. One extra slot fixes this, the same bounded-cost
 * pattern floorAwareOuterwearCandidates already uses for its own leanest
 * guarantee: the single item whose own warmth sits closest to warmthFloor,
 * added on top of the existing split rather than taken out of either half
 * of it — never shrinks the coverage the split already guarantees, only
 * ever +1 candidate, and a no-op when that item is already one of the ones
 * picked above.
 *
 * `warmthCeiling`, when given, keeps the warmest half honest on a hot day:
 * unfiltered, "warmest overall" always pulls in the wardrobe's genuinely
 * warmest items regardless of today's ceiling -- e.g. warmth-5/7 jeans at a
 * ceiling of 2 -- wasting half the pool on candidates that can never
 * produce a valid outfit, while the mid-warmth items that would actually
 * fit under the ceiling never enter the pool at all (reported bug: a
 * warmth-5-class bottom shown over a ceiling of 2, on a real wardrobe with
 * plenty of lighter options that never got the chance). With a ceiling
 * given, "warmest" means warmest among items that still fit under it,
 * falling back to the wardrobe's genuinely warmest only when literally
 * nothing clears the ceiling -- the extreme-day "closest available"
 * fallback (outfitsFor's own documented behavior) still needs real
 * candidates to try in that case. Omitted entirely, behavior is identical
 * to before this parameter existed.
 *
 * `slotSize`, when given, replaces MAX_SLOT_CANDIDATES as the total size of
 * the leanest/warmest split (and of the warmthFloor<=0 branch's own leanest
 * slice) -- see mergedByBandCenters in bandedOutfits.ts, whose own merged,
 * band-wide pool needs a larger slice than a single outfit slot's search
 * does to avoid a valid mid-range item being crowded out by wardrobe size
 * before the outfit search ever runs. Omitted, behavior is identical to
 * before this parameter existed.
 */
export function floorAwareCandidates(
  items: readonly ClothingItem[],
  warmthFloor: number,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  warmthCeiling?: number,
  slotSize: number = MAX_SLOT_CANDIDATES,
): ClothingItem[] {
  if (warmthFloor <= 0) return rankWithFairTiebreak(items, wornDaysAgo).slice(0, slotSize);

  const half = Math.ceil(slotSize / 2);
  const leanest = rankWithFairTiebreak(items, wornDaysAgo).slice(0, half);
  const underCeiling = warmthCeiling === undefined ? items : items.filter((item) => item.inferredWarmth <= warmthCeiling);
  const warmestBasis = underCeiling.length > 0 ? underCeiling : items;
  const warmest = rankWithFairTiebreak(warmestBasis, wornDaysAgo, true).slice(0, slotSize - half);

  const merged = new Map<string, ClothingItem>();
  for (const item of [...leanest, ...warmest]) merged.set(item.id, item);

  const closestToFloor = [...items].sort((a, b) => {
    const byDistance = Math.abs(a.inferredWarmth - warmthFloor) - Math.abs(b.inferredWarmth - warmthFloor);
    return byDistance !== 0 ? byDistance : recencyPenalty(a, wornDaysAgo) - recencyPenalty(b, wornDaysAgo);
  })[0];
  if (closestToFloor) merged.set(closestToFloor.id, closestToFloor);

  return [...merged.values()];
}

/**
 * The heaviest MAX_ACCESSORY_CANDIDATES Outerwear options (unchanged from a
 * plain heaviest-first, MAX_ACCESSORY_CANDIDATES-capped pool — the search
 * needs every one of those exactly as it did before), plus the single
 * leanest option on top, uncapped by the same limit.
 *
 * Reported bug (v1): a mild-cool day (e.g. 8°C, a warmth window of 14-20)
 * found no matching outfit even though the wardrobe had both a warmer coat
 * (an outfit built around it scored 23, over that day's ceiling) and a
 * lighter jacket that would have closed the gap — because a heaviest-only
 * pool never offers a lighter option once the closet holds
 * MAX_ACCESSORY_CANDIDATES (3) warmer Outerwear items, on any day, whatever
 * that day's own ceiling could actually fit.
 *
 * Reported bug (v2): fixing that by *splitting* the existing cap between
 * both ends (2 heaviest + 1 leanest, the same halving floorAwareCandidates
 * uses for Top/Bottom) shrank heavy-coat coverage instead of adding to it —
 * MAX_ACCESSORY_CANDIDATES is odd, so `Math.ceil(cap / 2)` handed the
 * *larger* half to the leanest side, leaving only the single warmest item in
 * the pool. A wool coat that wasn't literally the single highest-insulation
 * item (edged out by, say, a windproof shell scoring higher on warmth+wind
 * combined despite being less warm on its own) dropped out of the search
 * entirely, at every cold temperature, not just the specific one being
 * fixed — floorAwareCandidates' even MAX_SLOT_CANDIDATES (6) never exposed
 * this, since ceil(6/2) and 6-ceil(6/2) are both 3.
 *
 * Adding the leanest option on top of the existing heaviest-3, instead of
 * splitting the existing 3 between both ends, is what avoids that: heavy-coat
 * coverage is exactly what it was before this whole fix, and the pool is
 * merely one candidate larger (at most 4, only when the leanest option isn't
 * already among the heaviest 3) — a bounded, one-slot cost for one specific
 * slot, not a shared cap this search's own complexity budget depends on
 * staying small (see MAX_ACCESSORY_CANDIDATES's own doc comment).
 *
 * `warmthCeiling`, when given, keeps the heaviest-3 honest on a hot day —
 * the same fix floorAwareCandidates got for Top/Bottom, applied here for the
 * same reason: unfiltered, "heaviest overall" always offers the wardrobe's
 * genuinely heaviest coats regardless of today's ceiling, pushing an outfit
 * over it with no lighter Outerwear option ever tried instead (reported bug:
 * a warmth-6 Jacket shown over a ceiling of 4). With a ceiling given,
 * "heaviest" means heaviest among items that still fit under it, falling
 * back to the wardrobe's genuinely heaviest only when nothing clears the
 * ceiling — the extreme-cold "closest available" fallback still needs real
 * candidates to try in that case. Omitted entirely, behavior is identical to
 * before this parameter existed.
 */
export function floorAwareOuterwearCandidates(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  warmthCeiling?: number,
): ClothingItem[] {
  const underCeiling = warmthCeiling === undefined ? items : items.filter((item) => item.inferredWarmth <= warmthCeiling);
  const heaviestBasis = underCeiling.length > 0 ? underCeiling : items;
  const heaviest = layerFirst(heaviestBasis, wornDaysAgo);
  const leanest = rankWithFairTiebreak(items, wornDaysAgo).slice(0, 1);

  const merged = new Map<string, ClothingItem>();
  for (const item of [...heaviest, ...leanest]) merged.set(item.id, item);
  return [...merged.values()];
}

/**
 * Excludes Sandals from the shoe pool once any extra warmth is called for at
 * all (warmthFloor > 0 — see WARMTH_NEUTRAL_TEMP_C in utils/thermal.ts).
 *
 * Not a per-region floor like meetsLegFloor (see outfitScoring.ts): Sandals'
 * category ceiling for both warmth and wind is fixed at 0 regardless of
 * material (see CATEGORY_RANGE in utils/warmth.ts — there is nothing for a
 * floor check to ever pass), so filtering the candidate pool up front is
 * simpler than a check that would reject every Sandals candidate anyway, on
 * every branch, every time.
 */
export function shoeCandidatesFor(candidates: OutfitCandidates, warmthFloor: number): readonly ClothingItem[] {
  return warmthFloor > 0 ? candidates.shoes.filter((item) => item.category !== 'Sandals') : candidates.shoes;
}

/**
 * Excludes Shorts from the bottom/anchor pool once any extra warmth is
 * called for at all (warmthFloor > 0 — the same cutoff shoeCandidatesFor
 * already uses for Sandals).
 *
 * Not just a job for meetsLegFloor (outfitScoring.ts): a heavier material can
 * push Shorts' own warmth score up to exactly warmthFloor * LEG_WARMTH_FLOOR_FRACTION
 * at an ordinary cool temperature — denim Shorts scoring 2 against a floor of
 * 6 at 10°C felt, a reported bug — which lets bare legs clear a numeric
 * threshold that was never meant to certify coverage a garment doesn't have.
 * Unlike a Mini or Knee-length Skirt, Shorts can never be paired with Tights
 * to make up for that (see offerTights in outfitSlots.ts's buildSlots — only
 * a Skirt or Dress anchor ever offers Tights), so there is no combination
 * that makes bare-legged shorts weather-appropriate once real warmth is
 * needed; filtering them out of the pool up front is simpler than a
 * region-floor check that has no way to ever pass once the temperature
 * drops.
 */
export function bottomCandidatesFor(candidates: OutfitCandidates, warmthFloor: number): readonly ClothingItem[] {
  return excludesSleeveless(
    warmthFloor > 0
      ? candidates.bottoms.filter((item) => item.category !== 'Shorts')
      : candidates.bottoms,
    warmthFloor,
  );
}

/**
 * Excludes Sleeveless items from a torso-covering pool once any extra warmth
 * is called for at all (warmthFloor > 0 — the same cutoff shoeCandidatesFor
 * and bottomCandidatesFor's own Shorts exclusion already use).
 *
 * Reported bug this guards against: a sleeveless top, layered under a
 * Cardigan and Coat, was recommended at -14°C. Every region-floor check
 * (meetsTorsoFloor) it needs to clear can be satisfied by whatever's layered
 * *over* it — that's the whole point of a Cardigan or Coat existing as a
 * separate layer — so nothing about "does this outfit's torso region clear
 * its floor" ever depended on the base layer itself carrying any warmth at
 * all. A sleeveless base is bare skin at the one place closest to the body
 * regardless of what's buttoned over it, which is exactly the kind of fact a
 * numeric floor built from summed warmth scores has no way to see. Filtering
 * it out of the pool up front — the same way Sandals and Shorts already are
 * — is what actually stops it, rather than hoping some future layering
 * combination happens to fail the region floor too.
 */
export function excludesSleeveless(items: readonly ClothingItem[], warmthFloor: number): readonly ClothingItem[] {
  return warmthFloor > 0 ? items.filter((item) => item.sleeveLength !== 'Sleeveless') : items;
}

/**
 * The Top slot's real base-layer candidates — everything in the Top group
 * except Cardigan, with Sleeveless items excluded once warmthFloor calls for
 * it (see excludesSleeveless).
 *
 * A Cardigan is not a base layer: it is always worn open over one (a
 * T-Shirt, Top, Shirt or Dress) or under a Jacket/Coat, never as the torso's
 * only covering — see clearsCardiganLayerRule in pairs.ts, which is what
 * stops it from being paired with an incompatible base once it reaches its
 * own slot (see cardiganCandidates). Excluding it here is what stops it from
 * being the *only* torso covering in the first place: the Top slot is
 * required (except for a Dress anchor, which already covers the torso on
 * its own), so as long as Cardigan is absent from its pool, every complete
 * outfit is guaranteed a real base underneath any Cardigan it also wears.
 */
export function baseTopCandidates(tops: readonly ClothingItem[], warmthFloor: number): readonly ClothingItem[] {
  return excludesSleeveless(
    tops.filter((item) => item.category !== 'Cardigan'),
    warmthFloor,
  );
}

/** The Cardigan-only slice of the Top group — see baseTopCandidates for why Cardigan is split out of it, and excludesSleeveless for the Sleeveless cutoff. */
export function cardiganCandidates(tops: readonly ClothingItem[], warmthFloor: number): readonly ClothingItem[] {
  return excludesSleeveless(
    tops.filter((item) => item.category === 'Cardigan'),
    warmthFloor,
  );
}

/**
 * The T-Shirt-only slice of the Top group, offered as an extra, optional
 * layer *underneath* whatever fills the main Top slot — a thermal or a plain
 * tee under a Sweater or Shirt is a real, warmer combination the search
 * previously had no way to reach at all: the Top slot chooses exactly one
 * item, so a T-Shirt and a Sweater were always alternatives to each other,
 * never a stack. isCompatibleWithAll's distinctness check (outfitSlots.ts)
 * is what stops the same physical T-Shirt from also being the chosen Top;
 * nothing here or in buildSlots restricts which *other* Top item it can join
 * — same latitude Outerwear already has, and cheap to keep loose since
 * torsoWarmth (outfitScoring.ts) already counts every Top-group item present,
 * however many there are, so a genuinely redundant pairing only ever costs
 * ceiling headroom, never gets treated as free warmth.
 */
export function baseLayerCandidates(tops: readonly ClothingItem[], warmthFloor: number): readonly ClothingItem[] {
  return excludesSleeveless(
    tops.filter((item) => item.category === 'T-Shirt'),
    warmthFloor,
  );
}
