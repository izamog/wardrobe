import { CATEGORY_GROUP } from './categories';
import { generateClosestOutfits, type OutfitCandidates, type ScoredOutfit } from './outfitGenerator';
import type { CategoryGroup } from '../types/wardrobe';

/**
 * Picking a spread of outfits to show side by side — several real choices,
 * not the same choice re-shown with a different shoe or bag.
 *
 * generateClosestOutfits' own ranking already puts the closest-to-target
 * outfits first, but a wardrobe with several compatible shoes or scarves for
 * the same top-and-bottom pairing can fill an entire top-N slice with what
 * is, to the person wearing it, the same outfit five times over — the search
 * has no reason to know that's uninteresting, since every one of those really
 * is a distinct, valid combination.
 */

/**
 * The body-region groups that define an outfit's identity for this purpose.
 *
 * Outerwear and Shoes joined Top/Bottom/Dress here after a reported bug: two
 * outfits sharing the same Top+Bottom but wearing a different (functionally
 * identical) coat, or a different pair of boots, used to collapse to "the
 * same combo" — only the first-ranked coat/boots pairing ever survived this
 * function's dedup, so a second coat or a second and third boot the user
 * owned could never appear even once, regardless of PRIMARY_ANCHOR_GROUPS'/
 * SECONDARY_ANCHOR_GROUPS' own caps below, which only ever get a chance to
 * run on the combos that make it past this dedup in the first place. Scarf,
 * Belt, Bag and Tights remain outside CORE_GROUPS — those still vary freely
 * within what counts as "the same" recommendation, subject only to
 * SECONDARY_ANCHOR_GROUPS' own cap for Bag/Belt/Shoes.
 */
const CORE_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes']);

/** The Top/Bottom/Dress items an outfit is built around, as a stable, order-independent key — see CORE_GROUPS. */
function coreComboKey(outfit: ScoredOutfit): string {
  return outfit.items
    .filter((item) => CORE_GROUPS.has(CATEGORY_GROUP[item.category]))
    .map((item) => item.id)
    .sort()
    .join('+');
}

/**
 * The body-region groups tracked as a "primary" anchor -- capped in lockstep
 * with the escalation loop rankedDiverseOutfits already runs for
 * Bottom/Dress, now also including Outerwear.
 *
 * How many of the shown outfits the same primary anchor may... anchor:
 *
 * Reported bug (v1): at -15°C, every one of the 10 shown outfits used the
 * same (lightest) skirt — coreComboKey alone doesn't stop this, since a
 * different Top or Cardigan choice with the *same* skirt already counts as
 * a "different" combo.
 *
 * Reported bug (v2): raising this to 2 traded one bad pattern for another —
 * the two outfits sharing a bottom were almost always the top two ranked
 * candidates for it, which (since Top, Belt and Bag all contribute 0 warmth
 * — see outfitScoring.ts) routinely differ by nothing but a single swapped
 * sweater, then the *next* bottom's own top-two repeated the same pattern.
 * Four "varied" outfits read as two outfits shown twice. 1, not 2: every
 * selected outfit now anchors on a genuinely different Bottom or Dress, so
 * two outfits can never be "the same thing with one item swapped" by
 * construction — coreComboKey's own per-combo dedup already guarantees each
 * bottom's single slot is its single best-ranked outfit.
 *
 * Outerwear joined this same tier (Task 6) rather than getting its own,
 * separately-escalating cap: a repeated coat is exactly the same kind of
 * "read as the same outfit twice" complaint as a repeated bottom, worth
 * fixing on the same priority as Bottom/Dress, not after it.
 */
const PRIMARY_ANCHOR_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Bottom', 'Dress', 'Outerwear']);

/**
 * The groups tracked as a "secondary" anchor -- capped independently of
 * PRIMARY_ANCHOR_GROUPS, and only relaxed once the primary cap has already
 * reached its own ceiling (see rankedDiverseOutfits' escalation loop). A
 * repeated bag, belt or pair of shoes is a milder version of the same "same
 * outfit twice" complaint the primary tier exists for, but strictly less bad
 * than a repeated bottom, dress or coat — so every way to fix the primary
 * tier is exhausted before this tier is ever allowed to relax.
 *
 * Shoes joined Bag/Belt here for the same reason Outerwear joined
 * CORE_GROUPS above: once Shoes started counting toward combo identity, a
 * wardrobe with several equally-warm boots could otherwise fill the whole
 * result list with boot variants of a single Top+Bottom pairing before a
 * genuinely different Bottom was ever tried — this cap is what keeps that in
 * check, exactly the way it already does for a repeated Bag.
 */
const SECONDARY_ANCHOR_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Bag', 'Belt', 'Shoes']);

/** Every primary-anchor item id present in this outfit -- almost always exactly one (the Bottom/Dress anchor the search picks), plus Outerwear when present. */
function primaryAnchorIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => PRIMARY_ANCHOR_GROUPS.has(CATEGORY_GROUP[item.category])).map((item) => item.id);
}

/** Every secondary-anchor item id present in this outfit (Bag, Belt) -- zero, one, or two. */
function secondaryAnchorIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => SECONDARY_ANCHOR_GROUPS.has(CATEGORY_GROUP[item.category])).map((item) => item.id);
}

const MAX_OUTFITS_PER_ANCHOR = 1;
const MAX_OUTFITS_PER_ACCESSORY_ANCHOR = 1;

/**
 * Selects up to `count` outfits from a larger, already-ranked pool: at most
 * one per distinct core combo (see coreComboKey), — a hard ceiling, not a
 * preference — never more than `maxPerAnchor` anchored by the same
 * Bottom/Dress/Outerwear item, and never more than `maxPerAccessoryAnchor`
 * anchored by the same Bag/Belt item. Rank order (closest to target first,
 * ties broken by search order — see generateClosestOutfits) is preserved
 * throughout, so this only removes near-duplicates and over-represented
 * anchors, it never reorders around them.
 *
 * The two caps are tracked independently (an outfit can be excluded by
 * either one) but are not the same priority — see PRIMARY_ANCHOR_GROUPS and
 * SECONDARY_ANCHOR_GROUPS' own doc comments, and rankedDiverseOutfits' own
 * escalation loop for why the caller relaxes them in that order rather than
 * together.
 *
 * Neither cap is lifted by this function itself to reach `count`: a
 * wardrobe whose valid outfits genuinely concentrate on very few anchors
 * returns fewer than `count` rather than padding the list back out with an
 * anchor already shown — the reported bug (see PRIMARY_ANCHOR_GROUPS) was
 * exactly a list padded out with an over-represented bottom, so relaxing a
 * cap inside this function to hit a target length would bring the same
 * complaint back by another route. `maxPerAnchor`/`maxPerAccessoryAnchor`
 * are parameters, not always their MAX_OUTFITS_PER_* defaults, only so
 * rankedDiverseOutfits can call this again with a higher one as a fallback —
 * see that function's own doc comment for why relaxing them is a last
 * resort, not something a caller should reach for directly.
 *
 * With both caps at their default of 1, coreComboKey already guarantees
 * this single pass picks each anchor's single best-ranked outfit — an
 * anchor can never collide with itself on combo the way two different tops
 * under the same bottom used to, so there is nothing left for a second,
 * repeat-combo pass to ever find (every anchor hits its cap the moment its
 * first, best candidate is taken).
 *
 * `exemptAnchorId`, when given, is never blocked by either cap — it can
 * appear in the result set as many times as `usedCombos`/rank order
 * otherwise allow. This is for the one caller that pre-filters `ranked` to
 * outfits that all already share one specific anchor id
 * (`generateOutfitsWithItem`, pinning the anchor for the item the user
 * asked to build around): without the exemption, that anchor's own cap
 * would silently limit the whole result set to `maxPerAnchor`/
 * `maxPerAccessoryAnchor` outfits regardless of how much variety the other
 * slots offer, since every candidate shares it. Every *other* primary/
 * secondary anchor id keeps being capped normally — this is not a blanket
 * relaxation of diversity, only a targeted exemption for the one id every
 * candidate is already guaranteed to share.
 */
export function selectDiverseOutfits(
  ranked: readonly ScoredOutfit[],
  count: number,
  maxPerAnchor: number = MAX_OUTFITS_PER_ANCHOR,
  maxPerAccessoryAnchor: number = MAX_OUTFITS_PER_ACCESSORY_ANCHOR,
  exemptAnchorId?: string,
): ScoredOutfit[] {
  const selected: ScoredOutfit[] = [];
  const usedCombos = new Set<string>();
  const primaryCounts = new Map<string, number>();
  const secondaryCounts = new Map<string, number>();

  const underPrimaryCap = (outfit: ScoredOutfit): boolean =>
    primaryAnchorIds(outfit).every((id) => id === exemptAnchorId || (primaryCounts.get(id) ?? 0) < maxPerAnchor);
  const underSecondaryCap = (outfit: ScoredOutfit): boolean =>
    secondaryAnchorIds(outfit).every(
      (id) => id === exemptAnchorId || (secondaryCounts.get(id) ?? 0) < maxPerAccessoryAnchor,
    );

  for (const outfit of ranked) {
    if (selected.length >= count) return selected;
    if (usedCombos.has(coreComboKey(outfit)) || !underPrimaryCap(outfit) || !underSecondaryCap(outfit)) continue;
    for (const id of primaryAnchorIds(outfit))
      if (id !== exemptAnchorId) primaryCounts.set(id, (primaryCounts.get(id) ?? 0) + 1);
    for (const id of secondaryAnchorIds(outfit))
      if (id !== exemptAnchorId) secondaryCounts.set(id, (secondaryCounts.get(id) ?? 0) + 1);
    usedCombos.add(coreComboKey(outfit));
    selected.push(outfit);
  }

  return selected;
}

/**
 * The `count` outfits shown for a given weather target: the full ranked
 * search space, thinned to a varied set — see selectDiverseOutfits.
 *
 * Deliberately not "the top `count` closest, then diversify a fixed-size
 * slice of those": an early version capped the pool handed to
 * selectDiverseOutfits at a fixed number, on the (wrong) assumption that
 * would always be wide enough to cover every anchor the search tried. A
 * single lean bottom that ties at distance 0 with dozens of its own
 * shoe/scarf/bag variants can fill a fixed-size pool by itself, starving out
 * every other, equally valid bottom before selectDiverseOutfits ever saw it
 * — worse the larger and more accessory-rich the wardrobe, i.e. exactly
 * backwards from where headroom matters most. Passing Infinity here removes
 * that ceiling instead of raising it: generateClosestOutfits' own search is
 * already exhaustive and already sorts the full result set before slicing
 * regardless of what's passed as its own maxResults (see its own doc
 * comment), so this doesn't add search or sort cost — it only stops
 * discarding sorted results before selectDiverseOutfits gets a look at them.
 *
 * `minMeetsTarget` (0 by default, so every other caller — including every
 * existing test — is unaffected) is a floor on how many of the selected
 * outfits must actually meet the weather target, not just be returned.
 * Reported bug: "Today" is supposed to always offer a real choice, but a
 * wardrobe with only one or two bottoms that met today's target could
 * legitimately produce just one real match once the primary-anchor cap
 * capped repeats at 1 (see PRIMARY_ANCHOR_GROUPS' own doc comment) — correct
 * per-outfit, but a below-target-count result the caller never asked to
 * accept. When the strict, most-varied pass falls short, this retries in
 * two phases, in this order and never the reverse:
 *
 *   1. Raise `selectDiverseOutfits`'s primary-anchor cap (Bottom, Dress,
 *      Outerwear) one step at a time, up to `count`. A repeated coat or
 *      bottom is the worse "this reads as the same outfit twice" failure —
 *      see PRIMARY_ANCHOR_GROUPS — so every way to fix it is exhausted
 *      before the secondary tier is touched at all.
 *   2. Only once the primary cap has reached its own ceiling (`count`) and
 *      the floor is still unmet, raise the secondary-anchor cap (Bag, Belt)
 *      the same way, also up to `count`.
 *
 * Each phase trades away exactly as much variety as needed to reach the
 * floor, never more, and neither phase ever touches what actually counts as
 * meeting target (the weather bounds themselves are untouched) — until
 * either the floor is met or both caps have grown past `count`, at which
 * point relaxing them further cannot possibly help and whatever the last
 * attempt found is final.
 */
export function rankedDiverseOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  count: number,
  minMeetsTarget: number = 0,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ScoredOutfit[] {
  const ranked = generateClosestOutfits(
    candidates,
    dismatchedKeys,
    warmthFloor,
    warmthCeiling,
    windFloor,
    Infinity,
    wornDaysAgo,
  );

  const meetsCount = (outfits: ScoredOutfit[]): boolean =>
    outfits.filter((outfit) => outfit.meetsTarget).length >= minMeetsTarget;

  let selected = selectDiverseOutfits(ranked, count);
  if (meetsCount(selected)) return selected;

  // Phase 1: relax the primary (Bottom/Dress/Outerwear) cap first -- a
  // repeated coat is a worse outcome than a repeated bag, so every way to
  // fix the former is exhausted before the latter is ever allowed to relax.
  for (let maxPerAnchor = 2; !meetsCount(selected) && maxPerAnchor <= count; maxPerAnchor++) {
    selected = selectDiverseOutfits(ranked, count, maxPerAnchor);
  }
  if (meetsCount(selected)) return selected;

  // Phase 2: primary cap is already at its own ceiling (count) and still
  // insufficient -- now relax the secondary (Bag/Belt) cap.
  for (
    let maxPerAccessoryAnchor = 2;
    !meetsCount(selected) && maxPerAccessoryAnchor <= count;
    maxPerAccessoryAnchor++
  ) {
    selected = selectDiverseOutfits(ranked, count, count, maxPerAccessoryAnchor);
  }
  return selected;
}
