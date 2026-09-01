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
 * Outerwear joined Top/Bottom/Dress here after a reported bug: two outfits
 * sharing the same Top+Bottom but wearing a different (functionally
 * identical) coat used to collapse to "the same combo" — only the
 * first-ranked coat ever survived this function's dedup, so a second coat
 * the user owned could never appear even once, regardless of
 * PRIMARY_ANCHOR_GROUPS' own cap below, which only ever gets a chance to run
 * on the combos that make it past this dedup in the first place.
 *
 * Shoes does NOT belong here, despite the same reasoning seeming to apply to
 * boots — tried once (see git history), then reverted by a second reported
 * bug: including Shoes here meant two outfits differing *only* by shoes
 * counted as "different", so the search could (and did) show the exact same
 * Top+Bottom four times over with only the shoe swapped, which is precisely
 * the "same outfit re-shown" failure this whole function exists to prevent
 * — the reverse of the coat problem, since Shoes/Bag/Belt read as accessory
 * variation to a person looking at the outfit, not as part of "is this a
 * different outfit", the way a different coat or a different Top/Bottom
 * does. Boot rotation is still handled, just one tier down — see
 * SECONDARY_ANCHOR_GROUPS below, which caps a repeated pair of shoes the
 * same way it caps a repeated bag, without letting shoe variation alone
 * justify repeating the Top+Bottom itself.
 */
const CORE_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Top', 'Bottom', 'Dress', 'Outerwear']);

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
 *
 * Top deliberately does NOT join this tier, even though the same "read as
 * one outfit repeated" complaint applies to it too (see SECONDARY_ANCHOR_
 * GROUPS' own doc comment for where it actually landed and why) — tried
 * here first, then moved: sharing one escalating cap number with Bottom/
 * Outerwear meant that whatever cap Bottom's own diversity needed to reach
 * (which can go as high as `count`) was also how far Top's cap opened up,
 * so a Top that ties for best-ranked across most Bottoms could still repeat
 * as many times as Bottom's own escalation required, defeating the point.
 */
const PRIMARY_ANCHOR_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Bottom', 'Dress', 'Outerwear']);

/**
 * The groups tracked as a "secondary" anchor -- capped independently of
 * PRIMARY_ANCHOR_GROUPS, and only relaxed once the primary cap has already
 * reached its own ceiling (see rankedDiverseOutfits' escalation loop). A
 * repeated bag, belt, pair of shoes or top is a milder version of the same
 * "same outfit twice" complaint the primary tier exists for, but strictly
 * less bad than a repeated bottom, dress or coat — so every way to fix the
 * primary tier is exhausted before this tier is ever allowed to relax.
 *
 * Shoes joined Bag/Belt here for the same reason Outerwear joined
 * CORE_GROUPS above: once Shoes started counting toward combo identity, a
 * wardrobe with several equally-warm boots could otherwise fill the whole
 * result list with boot variants of a single Top+Bottom pairing before a
 * genuinely different Bottom was ever tried — this cap is what keeps that in
 * check, exactly the way it already does for a repeated Bag.
 *
 * Reported bug (v3): Top had no cap at all -- coreComboKey includes it, so a
 * repeated Top paired with a *different* Bottom still counted as a
 * genuinely different combo (correctly), but nothing stopped the search's
 * own best-ranked Top from independently winning that same tie for every
 * Bottom's own buildSlots call, since Top contributes 0 warmth either way
 * and so ties near-identically across most Bottoms — five or six outfits
 * anchored on genuinely different Bottoms, every one wearing the identical
 * sweater. Landed here rather than in PRIMARY_ANCHOR_GROUPS specifically so
 * its own cap stays independent of however far Bottom/Outerwear need to
 * escalate — see PRIMARY_ANCHOR_GROUPS' own doc comment for the version
 * that shared the cap and why that didn't hold Top down.
 */
const SECONDARY_ANCHOR_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Bag', 'Belt', 'Shoes', 'Top']);

/** Every primary-anchor item id present in this outfit -- almost always exactly one (the Bottom/Dress anchor the search picks), plus Outerwear when present. */
function primaryAnchorIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => PRIMARY_ANCHOR_GROUPS.has(CATEGORY_GROUP[item.category])).map((item) => item.id);
}

/** Every secondary-anchor item id present in this outfit (Top, Bag, Belt, Shoes) -- Top and Shoes are always present, Bag/Belt only when the outfit called for them. */
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

  const meetsTargetCount = (outfits: ScoredOutfit[]): number =>
    outfits.filter((outfit) => outfit.meetsTarget).length;

  let selected = selectDiverseOutfits(ranked, count);
  if (meetsTargetCount(selected) >= minMeetsTarget) return selected;

  // Reported bug: a wardrobe that can never produce minMeetsTarget outfits
  // meeting the weather target at all -- for reasons entirely unrelated to
  // anchor diversity, e.g. too few bottoms warm enough for today -- made
  // both escalation phases below climb all the way to `count` anyway,
  // since relaxing maxPerAnchor/maxPerAccessoryAnchor was the only lever
  // either loop had, even though relaxing those caps can never change how
  // many outfits meet the weather target (that's warmthFloor/Ceiling/
  // windFloor's job, untouched by anything below). The result: every anchor
  // cap maxed out for nothing, so Today showed the same Top+Shoes in all 6
  // slots even though the wardrobe had real Bottom/Bag variety a much
  // lower cap would have kept intact.
  //
  // achievableTarget is the most outfits meeting target this wardrobe can
  // ever produce, at any cap level (the fully-relaxed selection is a valid
  // upper bound: every cap below it is strictly more restrictive on which
  // combos survive coreComboKey's dedup, never less). Escalation below
  // stops as soon as it reaches that ceiling, not the original
  // minMeetsTarget, so a wardrobe that can only ever meet target 3 times
  // stops trying at whatever cap first reaches 3 -- often the strict
  // pass itself -- instead of needlessly maxing out every cap chasing a
  // floor it was never going to reach.
  //
  // A wardrobe that can't meet target even once (achievableTarget 0) is a
  // different case, not a "stop immediately" one: outfitsFor's own fallback
  // shows the *whole* returned list once nothing meets target (see its own
  // doc comment), so escalation must still climb toward `count` there --
  // achievableCount is that same ceiling for plain outfit count, so this
  // wardrobe still gets as many closest-available alternatives as it can
  // support, not just whatever the strict pass alone happened to find.
  const fullyRelaxed = selectDiverseOutfits(ranked, count, count, count);
  const achievableTarget = Math.min(minMeetsTarget, meetsTargetCount(fullyRelaxed));
  // Only the achievableTarget === 0 case switches the goal to plain count --
  // whenever some nonzero number of outfits CAN meet target, reaching that
  // number is still the only goal (unchanged from before this fix): trading
  // away more variety than needed just to also pad the list out to `count`
  // is exactly the over-escalation this fix exists to stop.
  const reachedAchievable: (outfits: ScoredOutfit[]) => boolean =
    achievableTarget > 0
      ? (outfits) => meetsTargetCount(outfits) >= achievableTarget
      : (outfits) => outfits.length >= Math.min(count, fullyRelaxed.length);

  if (reachedAchievable(selected)) return selected;

  // Phase 1: relax the primary (Bottom/Dress/Outerwear) cap first -- a
  // repeated coat is a worse outcome than a repeated bag, so every way to
  // fix the former is exhausted before the latter is ever allowed to relax.
  for (let maxPerAnchor = 2; !reachedAchievable(selected) && maxPerAnchor <= count; maxPerAnchor++) {
    selected = selectDiverseOutfits(ranked, count, maxPerAnchor);
  }
  if (reachedAchievable(selected)) return selected;

  // Phase 2: primary cap is already at its own ceiling (count) and still
  // insufficient -- now relax the secondary (Bag/Belt) cap.
  for (
    let maxPerAccessoryAnchor = 2;
    !reachedAchievable(selected) && maxPerAccessoryAnchor <= count;
    maxPerAccessoryAnchor++
  ) {
    selected = selectDiverseOutfits(ranked, count, count, maxPerAccessoryAnchor);
  }
  return selected;
}
