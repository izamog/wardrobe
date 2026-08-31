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

/** The body-region groups that define an outfit's identity for this purpose — not Shoes, Outerwear or any accessory, which are what two "different" results here are allowed to vary by. */
const CORE_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Top', 'Bottom', 'Dress']);

/** The Top/Bottom/Dress items an outfit is built around, as a stable, order-independent key — see CORE_GROUPS. */
function coreComboKey(outfit: ScoredOutfit): string {
  return outfit.items
    .filter((item) => CORE_GROUPS.has(CATEGORY_GROUP[item.category]))
    .map((item) => item.id)
    .sort()
    .join('+');
}

/**
 * The id of whichever Bottom or Dress item anchors this outfit — see
 * MAX_OUTFITS_PER_BOTTOM. An outfit always has exactly one (generateOutfits'
 * search picks exactly one anchor per outfit), so this is never empty in
 * practice; '' only guards the type.
 */
function bottomId(outfit: ScoredOutfit): string {
  return (
    outfit.items.find((item) => CATEGORY_GROUP[item.category] === 'Bottom' || CATEGORY_GROUP[item.category] === 'Dress')
      ?.id ?? ''
  );
}

/**
 * How many of the shown outfits the same Bottom or Dress may anchor.
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
 */
const MAX_OUTFITS_PER_BOTTOM = 1;

/**
 * Selects up to `count` outfits from a larger, already-ranked pool: at most
 * one per distinct core combo (see coreComboKey), and — a hard ceiling, not
 * a preference — never more than MAX_OUTFITS_PER_BOTTOM anchored by the same
 * Bottom or Dress. Rank order (closest to target first, ties broken by
 * search order — see generateClosestOutfits) is preserved throughout, so
 * this only removes near-duplicates and over-represented anchors, it never
 * reorders around them.
 *
 * The per-bottom limit is never lifted to reach `count`: a wardrobe whose
 * valid outfits genuinely concentrate on very few bottoms returns fewer than
 * `count` rather than padding the list back out with a bottom already shown
 * — the reported bug was exactly a list padded out with an over-represented
 * bottom, so relaxing this cap to hit a target length would bring the same
 * complaint back by another route.
 *
 * With MAX_OUTFITS_PER_BOTTOM at its default of 1, coreComboKey already
 * guarantees this single pass picks each bottom's single best-ranked
 * outfit — a bottom can never collide with itself on combo the way two
 * different tops under it used to, so there is nothing left for a second,
 * repeat-combo pass to ever find (every bottom hits its cap the moment its
 * first, best candidate is taken). An earlier version of this function had
 * one anyway, for when the cap allowed a second outfit per bottom; removed
 * along with lowering the cap to 1, rather than left in place doing
 * nothing.
 *
 * `maxPerBottom` is a parameter, not always MAX_OUTFITS_PER_BOTTOM, only so
 * rankedDiverseOutfits can call this again with a higher one as a fallback —
 * see that function's own doc comment for why relaxing it is a last resort,
 * not something a caller should reach for directly.
 */
export function selectDiverseOutfits(
  ranked: readonly ScoredOutfit[],
  count: number,
  maxPerBottom: number = MAX_OUTFITS_PER_BOTTOM,
): ScoredOutfit[] {
  const selected: ScoredOutfit[] = [];
  const usedCombos = new Set<string>();
  const bottomCounts = new Map<string, number>();

  const underBottomCap = (outfit: ScoredOutfit): boolean =>
    (bottomCounts.get(bottomId(outfit)) ?? 0) < maxPerBottom;

  for (const outfit of ranked) {
    if (selected.length >= count) return selected;
    if (usedCombos.has(coreComboKey(outfit)) || !underBottomCap(outfit)) continue;
    const id = bottomId(outfit);
    bottomCounts.set(id, (bottomCounts.get(id) ?? 0) + 1);
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
 * legitimately produce just one real match once MAX_OUTFITS_PER_BOTTOM
 * capped repeats at 1 (see that constant's own doc comment) — correct
 * per-outfit, but a below-target-count result the caller never asked to
 * accept. When the strict, most-varied pass falls short, this retries with
 * `selectDiverseOutfits`'s per-bottom cap raised by one step at a time —
 * trading away exactly as much variety as needed to reach the floor, never
 * more, and never touching what actually counts as meeting target (the
 * weather bounds themselves are untouched) — until either the floor is met
 * or the cap has grown past `count`, at which point relaxing it further
 * cannot possibly help and whatever the last attempt found is final.
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
  const ranked = generateClosestOutfits(candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, Infinity, wornDaysAgo);

  let selected = selectDiverseOutfits(ranked, count);
  for (
    let maxPerBottom = 2;
    selected.filter((outfit) => outfit.meetsTarget).length < minMeetsTarget && maxPerBottom <= count;
    maxPerBottom++
  ) {
    selected = selectDiverseOutfits(ranked, count, maxPerBottom);
  }
  return selected;
}
