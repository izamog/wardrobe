/** @jest-environment node */
import { bandOrderFor, coreOutfitsForBands, selectBandedOutfits, toppedUpForBand, freshnessPenalty, rankNow } from '../bandedOutfits';
import { splitIntoWarmthBands } from '../warmthBands';
import type { WarmthBand } from '../warmthBands';
import { emptyCandidates, item, resetSeq, noDismatches, NO_CEILING } from '../outfitGeneratorTestHelpers';
import { warmthFloor } from '../thermal';

beforeEach(() => resetSeq());

describe('coreOutfitsForBands', () => {
  it('never includes a Scarf or Tights item in any core outfit', () => {
    const bottom = item('Skirt', { inferredWarmth: 0 });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const scarf = item('Scarf');
    const tights = item('Tights');
    const bands = splitIntoWarmthBands(0, 10);

    const results = coreOutfitsForBands(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf], tights: [tights] }),
      noDismatches,
      0,
      10,
      0,
      bands,
    );

    for (const outfit of results) {
      expect(outfit.items.some((i) => i.category === 'Scarf' || i.category === 'Tights')).toBe(false);
    }
  });

  it('reaches a bottom that is only the closest-to-target item for one specific band, not the global leanest/warmest', () => {
    // Seven bottoms spread across the warmth range: the middle one (warmth 3)
    // is neither in the leanest-3 (0,1,2) nor the warmest-3 (9,8,7) of the
    // *global* split -- it only enters the pool because the median band's
    // own center, scaled into the leg region's raw-inferredWarmth units by
    // LEG_WARMTH_FLOOR_FRACTION (0.25), lands exactly on it: floor 0,
    // ceiling 24 -> median band center 12 -> leg target 12*0.25 = 3.
    const warmths = [0, 1, 2, 3, 7, 8, 9];
    const bottoms = warmths.map((w) => item('Pants', { id: `w${w}`, inferredWarmth: w }));
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bands = splitIntoWarmthBands(0, 24);

    const results = coreOutfitsForBands(
      emptyCandidates({ bottoms, tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    const bottomIdsUsed = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
    expect(bottomIdsUsed.has('w3')).toBe(true);
  });
});

describe('selectBandedOutfits', () => {
  it('returns 2 outfits per band, median first, then cooler, then warmer', () => {
    // A rich wardrobe: 6 bottoms and 6 tops spread across the warmth range,
    // enough variety that every band can fill its 2 slots without borrowing.
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i * 2 }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    expect(results).toHaveLength(6);
  });

  it('tags each outfit with the band slot it fills: 2 median, then 2 cooler, then 2 warmer', () => {
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i * 2 }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    expect(results.map((o) => o.band)).toEqual(['median', 'median', 'cooler', 'cooler', 'warmer', 'warmer']);
  });

  it('never uses the same item more than twice across the whole 6-outfit set', () => {
    const bottoms = Array.from({ length: 8 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 8 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bags = Array.from({ length: 8 }, (_, i) => item('Bag', { id: `bag-${i}` }));
    const bands = splitIntoWarmthBands(0, 14);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes, bags }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    const counts = new Map<string, number>();
    for (const outfit of results) {
      for (const outfitItem of outfit.items) {
        counts.set(outfitItem.id, (counts.get(outfitItem.id) ?? 0) + 1);
      }
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('when an item is reused, the two outfits sharing it differ in every other item', () => {
    // Thin wardrobe: only 2 distinct bottoms, forcing at least one to repeat
    // across two of the 6 slots -- when it does, every other slot in those
    // two outfits must differ.
    const bottomA = item('Pants', { id: 'bottom-a', inferredWarmth: 2 });
    const bottomB = item('Pants', { id: 'bottom-b', inferredWarmth: 6 });
    const tops = Array.from({ length: 8 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bags = Array.from({ length: 8 }, (_, i) => item('Bag', { id: `bag-${i}` }));
    const bands = splitIntoWarmthBands(0, 10);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops, shoes, bags }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    const byBottom = new Map<string, (typeof results)[number][]>();
    for (const outfit of results) {
      const bottomId = outfit.items.find((i) => i.category === 'Pants')?.id;
      if (!bottomId) continue;
      byBottom.set(bottomId, [...(byBottom.get(bottomId) ?? []), outfit]);
    }
    for (const outfitsSharingABottom of byBottom.values()) {
      if (outfitsSharingABottom.length < 2) continue;
      const [first, second] = outfitsSharingABottom;
      const firstOtherIds = new Set(first.items.filter((i) => i.category !== 'Pants').map((i) => i.id));
      const secondOtherIds = second.items.filter((i) => i.category !== 'Pants').map((i) => i.id);
      for (const id of secondOtherIds) {
        expect(firstOtherIds.has(id)).toBe(false);
      }
    }
  });

  it('a thin wardrobe fills what non-near-duplicate outfits it can support, without falling back to reuse when 2 fresh outfits already exhaust it', () => {
    // 2 bottoms, 2 tops, 2 shoes -- only 2 fully-disjoint (non-near-duplicate)
    // combinations exist: bottom0+top0+shoes0 and bottom1+top1+shoes1. Under
    // the new tier-1 (valid+fresh) preference, those two maximally-spread
    // combos get picked first. Every remaining candidate then necessarily
    // shares at least 2 of the 3 categories with one of those two already-
    // shown outfits (pigeonhole: only 2 distinct values per category), so
    // violatesUniqueness's sibling-overlap rule (unchanged -- it blocks a
    // second use of an item if its first-use outfit already shares ANOTHER
    // item with the new candidate) blocks every one of them. Verified
    // empirically (temporary console.log of results.length and the picked
    // item ids): exactly 2 outfits, fully disjoint from each other, is what
    // this wardrobe actually supports once freshness is preferred by
    // default -- it no longer falls back to the old cap-2-reuse behavior
    // (which produced 4) because tier 1 alone already exhausts the
    // non-duplicate combinations before any tier that would allow reuse is
    // ever tried.
    const bottoms = Array.from({ length: 2 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: 0 }));
    const tops = Array.from({ length: 2 }, (_, i) => item('T-Shirt', { id: `top-${i}` }));
    const shoes = Array.from({ length: 2 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    expect(results.length).toBe(2);
    const bottomIds = results.map((o) => o.items.find((i) => i.category === 'Pants')?.id);
    expect(new Set(bottomIds).size).toBe(2);
    // 2 items x 2 uses = 4 is still the hard system-wide ceiling (tier 4's
    // own cap) -- this invariant still holds even though this particular
    // thin wardrobe never needs to reach it.
    const counts = new Map<string, number>();
    for (const outfit of results) {
      for (const outfitItem of outfit.items) {
        counts.set(outfitItem.id, (counts.get(outfitItem.id) ?? 0) + 1);
      }
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('prefers a valid outfit over an invalid one closer to band.center, rather than ranking by raw distance alone', () => {
    // Reported bug (real wardrobe): a mini skirt padded with a heavy top
    // and jacket can land numerically closer to a band's center than a
    // genuinely valid trousers-based outfit sitting a little further from
    // it, even though the skirt outfit fails its own leg-region floor and
    // the trousers one doesn't. warmthFloor 12 -> legTarget 3 (1/4):
    // skirt's own legWarmth (0, Bottom weight 0.6 * inferredWarmth 0) fails
    // on its own; trousers' legWarmth (6) passes. Both share the same top
    // (torsoWarmth 8 clears torsoTarget 4 either way), so only the leg
    // floor differs. skirtTotal = 0.6*0 + 8(top) + 7(jacket) = 15; pantsTotal
    // = 0.6*6 + 8 + 7 = 18.6 -- band.center 15.5 sits closer to skirtTotal
    // (gap 0.5) than to pantsTotal (gap 3.1), so a pure distance sort would
    // wrongly prefer the invalid skirt outfit.
    const skirt = item('Skirt', { id: 'skirt', inferredWarmth: 0 });
    const trousers = item('Pants', { id: 'trousers', inferredWarmth: 6 });
    const top = item('Sweater', { id: 'top', inferredWarmth: 8 });
    const jacket = item('Jacket', { id: 'jacket', inferredWarmth: 7 });
    const shoes = item('Shoes', { id: 'shoes' });

    const median = { min: 0, max: 30, center: 15.5 };
    const cooler = { min: 0, max: 30, center: 5 };
    const warmer = { min: 0, max: 30, center: 25 };

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms: [skirt, trousers], tops: [top], outerwear: [jacket], shoes: [shoes] }),
      noDismatches,
      12,
      30,
      0,
      { cooler, median, warmer },
    );

    const medianPicks = results.filter((o) => o.band === 'median');
    expect(medianPicks.length).toBeGreaterThan(0);
    for (const outfit of medianPicks) {
      expect(outfit.items.some((i) => i.id === 'trousers')).toBe(true);
      expect(outfit.meetsTarget).toBe(true);
    }
  });

  it('picks warmer last (and cooler gets priority) at or above the 20°C neutral point', () => {
    // One dominant Sweater+Jacket pairing, plus 3 genuine alternates (3 more
    // Sweaters, 3 more Jackets -- 4 distinct Sweaters/Jackets total). Tight
    // on purpose: verified empirically (temporary console.log of every
    // band's picks) that with this exact shape, ALL 4 Tops end up used
    // (once each) by median+cooler before warmer's turn -- median takes
    // dominant-top + alt-top-0, cooler takes alt-top-1 + alt-top-2 -- so by
    // the time warmer picks, no fresh Top exists anywhere and warmer must
    // fall through to the reuse tier for both of its slots. Despite that,
    // it still finds 2 *meetsTarget* outfits (one reusing dominant-jacket,
    // one reusing a still-only-once-used alt), because the reuse budget was
    // spent evenly rather than one item being hogged.
    //
    // The mechanism this proves: verified by temporarily collapsing
    // selectBandedOutfits' own `tiers` array to the old 2-tier shape
    // ([[true, violatesUniqueness], [false, violatesUniqueness]], i.e. no
    // dedicated fresh-preferred tier -- rankNow's own freshness tiebreak
    // still applies as a secondary sort within each tier). Under that
    // collapsed shape, median reuses dominant-top for BOTH of its own two
    // outfits (rankNow's soft tiebreak alone doesn't stop a band from
    // hogging one pairing across its own two slots the way the dedicated
    // fresh-preferred tier does), leaving alt-top-1/2 to cooler and
    // alt-top-0 to warmer -- which warmer then also has to reuse for both
    // of ITS slots, the literal "single pairing dominates" bug. Under the
    // real (current) code, median instead spreads across dominant-top and
    // alt-top-0 -- one outfit each, not the same item twice -- which is
    // what leaves every other band a genuinely even reuse budget to work
    // with. That's asserted directly below (medianPicks use 2 different
    // Tops), not just inferred from the final counts.
    const dominantTop = item('Sweater', { id: 'dominant-top', inferredWarmth: 10 });
    const dominantJacket = item('Jacket', { id: 'dominant-jacket', inferredWarmth: 10 });
    const altTops = Array.from({ length: 3 }, (_, i) => item('Sweater', { id: `alt-top-${i}`, inferredWarmth: 9 - i }));
    const altJackets = Array.from({ length: 3 }, (_, i) => item('Jacket', { id: `alt-jacket-${i}`, inferredWarmth: 9 - i }));
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: 4 + i }));
    const shoes = Array.from({ length: 4 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bags = Array.from({ length: 4 }, (_, i) => item('Bag', { id: `bag-${i}`, inferredWarmth: i }));
    const candidates = emptyCandidates({
      bottoms,
      tops: [dominantTop, ...altTops],
      outerwear: [dominantJacket, ...altJackets],
      shoes,
      bags,
    });
    // warmthFloor 0 -> at/above 20°C neutral -> warmer goes last. (0-30,
    // not 0-40: verified empirically to be the range where this specific
    // item/bottom fixture is actually load-bearing for warmer.)
    const bands = splitIntoWarmthBands(0, 30);

    const results = selectBandedOutfits(candidates, noDismatches, 0, NO_CEILING, 0, bands);

    const bandTags = results.map((o) => o.band);
    expect(bandTags.slice(0, 2)).toEqual(['median', 'median']);

    // The regression guard for the freshness-spreading mechanism itself:
    // median's own two outfits use two different Tops, not the same one
    // twice -- see the comment above for why this is what keeps warmer's
    // reuse budget viable later.
    const medianTopIds = results.filter((o) => o.band === 'median').map((o) => o.items.find((i) => i.category === 'Sweater')?.id);
    expect(new Set(medianTopIds).size).toBe(2);

    // warmer (picked last here) should still fill both of its slots with a
    // *meetsTarget* outfit, despite every Top already being claimed once by
    // the time it picks -- asserting the exact count (not just >0) is what
    // makes this a real regression guard.
    const warmerPicks = results.filter((o) => o.band === 'warmer');
    expect(warmerPicks.length).toBe(2);
    for (const outfit of warmerPicks) {
      expect(outfit.meetsTarget).toBe(true);
    }
  });

  it('picks cooler last (and warmer gets priority) below the 20°C neutral point', () => {
    // Mirrors the "picks warmer last" test above: one dominant Sweater+
    // Jacket pairing plus 3 genuine alternates (4 distinct Sweaters/Jackets
    // total) -- see that test's comment for the full rationale (verified
    // empirically the same way here: median and warmer between them use
    // every Top once before cooler's turn, so cooler must fall through to
    // the reuse tier for both slots, and still lands on 2 meetsTarget
    // outfits because the budget was spread rather than hogged). Uses
    // different warmth values (12/11/9/8 instead of 10/9/8/7) and a
    // different band range (5-35 instead of 0-30) than that test, since
    // the neutral-point boundary requires warmthFloor > 0 to put cooler
    // last instead of warmer.
    const dominantTop = item('Sweater', { id: 'dominant-top', inferredWarmth: 12 });
    const dominantJacket = item('Jacket', { id: 'dominant-jacket', inferredWarmth: 12 });
    const altTops = [11, 9, 8].map((w, i) => item('Sweater', { id: `alt-top-${i}`, inferredWarmth: w }));
    const altJackets = [11, 9, 8].map((w, i) => item('Jacket', { id: `alt-jacket-${i}`, inferredWarmth: w }));
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: 4 + i }));
    const shoes = Array.from({ length: 4 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bags = Array.from({ length: 4 }, (_, i) => item('Bag', { id: `bag-${i}`, inferredWarmth: i }));
    const candidates = emptyCandidates({
      bottoms,
      tops: [dominantTop, ...altTops],
      outerwear: [dominantJacket, ...altJackets],
      shoes,
      bags,
    });
    // warmthFloor 5 (> 0) -> below 20°C neutral -> cooler goes last.
    const bands = splitIntoWarmthBands(5, 35);

    const results = selectBandedOutfits(candidates, noDismatches, 5, NO_CEILING, 0, bands);

    // The same freshness-spreading regression guard as "picks warmer last":
    // median's own two outfits use two different Tops, not the same one
    // twice.
    const medianTopIds = results.filter((o) => o.band === 'median').map((o) => o.items.find((i) => i.category === 'Sweater')?.id);
    expect(new Set(medianTopIds).size).toBe(2);

    // cooler (picked last here) should still fill both of its slots with a
    // *meetsTarget* outfit -- asserting the exact count (not just >0) is
    // what makes this a real regression guard, same reasoning as the
    // "picks warmer last" test above.
    const coolerPicks = results.filter((o) => o.band === 'cooler');
    expect(coolerPicks.length).toBe(2);
    for (const outfit of coolerPicks) {
      expect(outfit.meetsTarget).toBe(true);
    }
  });

  it('a borrowed (adjacent-band) pick also reflects live reuse state, not a stale pre-computed ranking', () => {
    // Reuses the same thin-wardrobe shape as the existing borrowing test
    // below, just confirming borrowing still works under the new dynamic
    // order + live re-ranking rather than asserting anything new about
    // freshness specifically (that's covered by the rankNow unit tests in
    // Task 2).
    const bottoms = Array.from({ length: 2 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 2 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 2 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    expect(results.length).toBeGreaterThan(0);
    const counts = new Map<string, number>();
    for (const outfit of results) {
      for (const outfitItem of outfit.items) {
        counts.set(outfitItem.id, (counts.get(outfitItem.id) ?? 0) + 1);
      }
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('borrows a donor band\'s valid outfit rather than falling back to an invalid one from the primary band', () => {
    // The literal original bug report (35C/21C): a band's own topped-up
    // list can end up with zero valid, non-reuse-conflicting candidates
    // while a donor band's own topped-up list -- the SAME core outfit,
    // topped up toward a DIFFERENT band.center -- has a valid one.
    //
    // Mechanism: a single Bottom+Top+Shoes core (warmth 4*0.6 + 4*1 + 0 =
    // 6.4, weighted) sits below warmthFloor 8, so it fails the whole-outfit
    // floor (meetsTarget false) as generated -- but region floors already
    // pass (legTarget 2, torsoTarget 2.67, both cleared). topUpToward only
    // attempts a warmth-boosting Scarf addition when
    // `core.warmth < band.center` (needsWarmthBoost) -- so a band whose
    // own center sits AT OR BELOW 6.4 never tries the boost and stays
    // invalid, while a band whose center sits ABOVE 6.4 does try it, finds
    // the compatible Scarf (weighted warmth 5*0.8=4, bringing the total to
    // 10.4 >= floor 8), and becomes valid.
    //
    // median and cooler here both have a low center (6, below 6.4) --
    // their own toppedUp version of this one core outfit stays invalid.
    // warmer's center (15) triggers the boost, making warmer's own version
    // valid. median is always processed first (bandOrderFor), so by the
    // time it picks, nothing has been claimed yet -- it should borrow
    // warmer's valid, Scarf-boosted version rather than settling for its
    // own invalid one.
    //
    // Verified empirically (temporarily restricting selectBandedOutfits'
    // per-band `sources` to just the primary band, no donors at all): with
    // borrowing disabled, median falls back to the invalid, Scarf-less
    // version (meetsTarget false) -- exactly the reported bug. With
    // borrowing enabled (the real code, asserted below), it finds the
    // donor's valid version instead.
    const bottom = item('Pants', { id: 'bottom', inferredWarmth: 4 });
    const top = item('T-Shirt', { id: 'top', inferredWarmth: 4 });
    const shoes = item('Shoes', { id: 'shoes', inferredWarmth: 0 });
    const scarf = item('Scarf', { id: 'scarf', inferredWarmth: 5 });

    const median = { min: 0, max: 30, center: 6 };
    const cooler = { min: 0, max: 30, center: 6 };
    const warmer = { min: 0, max: 30, center: 15 };

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf] }),
      noDismatches,
      8,
      NO_CEILING,
      0,
      { cooler, median, warmer },
    );

    const medianPicks = results.filter((o) => o.band === 'median');
    expect(medianPicks.length).toBeGreaterThan(0);
    for (const outfit of medianPicks) {
      expect(outfit.meetsTarget).toBe(true);
      expect(outfit.items.some((i) => i.id === 'scarf')).toBe(true);
    }
  });

  it('a plentiful wardrobe never needs tier-2 reuse: no item appears in more than one shown outfit', () => {
    // 8 distinct Bottoms/Tops/Shoes -- enough for 6 fully-fresh outfits
    // with room to spare, so tier 1 (valid + fresh, cap 1) alone should
    // suffice for every slot; tier 2's cap-2 reuse allowance should never
    // be needed. Deliberately Bag/Belt/Scarf-free: those are `preferred`
    // (not required) accessory slots that outfitDedup.ts's
    // dropAccessoryFreeDuplicates always keeps paired with an accessory
    // when one exists, attaching the SAME best-ranked accessory to most/
    // all core outfits regardless of Bottom/Top -- verified empirically
    // (temporary console.log) that this pre-existing, band-agnostic
    // core-generation behavior (not something selectBandedOutfits controls)
    // concentrates reuse on a handful of accessory items even when 8 are
    // available, unrelated to the reuse-tightening default under test here.
    // Bottom/Top/Shoes are the categories tier 1's fresh-preference
    // actually governs end-to-end, so they're what this test checks.
    const bottoms = Array.from({ length: 8 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 8 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bands = splitIntoWarmthBands(0, 14);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    expect(results).toHaveLength(6);
    const counts = new Map<string, number>();
    for (const outfit of results) {
      for (const outfitItem of outfit.items) {
        counts.set(outfitItem.id, (counts.get(outfitItem.id) ?? 0) + 1);
      }
    }
    for (const count of counts.values()) {
      expect(count).toBe(1);
    }
  });

  it('a single scarce item in a required category is still reused up to the old cap of 2, not silently dropped to fewer outfits', () => {
    // Exactly 1 Bottom (Pants, Skirt and Dress are all in the same
    // CATEGORY_GROUP, so this is a genuine "only one bottom" wardrobe) --
    // every outfit needs one, and the hard cap on any single
    // item is 2 uses across the whole day (violatesUniqueness's own
    // ceiling, tier 4's fallback), so at most 2 outfits are mathematically
    // possible here regardless of how many Tops/Shoes exist. median is
    // always processed first (bandOrderFor), so it claims both of the
    // scarce Bottom's 2 allowed uses -- exactly the "only own one pair of
    // trousers" scenario the reuse-tightening default is meant not to
    // break: the tightened cap-1 *preference* still yields to cap-2 reuse
    // once no fresh alternative exists, rather than stopping at 1 outfit
    // or falling back to an invalid one.
    const onlyBottom = item('Pants', { id: 'only-bottom', inferredWarmth: 4 });
    const tops = Array.from({ length: 8 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bands = splitIntoWarmthBands(0, 14);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms: [onlyBottom], tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    expect(results.length).toBe(2);
    for (const outfit of results) {
      expect(outfit.meetsTarget).toBe(true);
      expect(outfit.items.some((i) => i.id === 'only-bottom')).toBe(true);
    }
    const bottomUses = results.filter((o) => o.items.some((i) => i.id === 'only-bottom')).length;
    expect(bottomUses).toBe(2);
  });
});

describe('freshnessPenalty', () => {
  it('is 0 when none of the outfit\'s tracked items have been used yet', () => {
    const outfit = { items: [item('Pants', { id: 'p1' }), item('Sweater', { id: 's1' })], warmth: 0, wind: 0, meetsTarget: true };
    expect(freshnessPenalty(outfit, new Map())).toBe(0);
  });

  it('counts each already-used tracked item once', () => {
    const outfit = { items: [item('Pants', { id: 'p1' }), item('Sweater', { id: 's1' }), item('Shoes', { id: 'sh1' })], warmth: 0, wind: 0, meetsTarget: true };
    const useCounts = new Map([['p1', 1], ['sh1', 2]]);
    expect(freshnessPenalty(outfit, useCounts)).toBe(2);
  });

  it('never counts Tights, matching trackedItemIds\' own exclusion', () => {
    const outfit = { items: [item('Skirt', { id: 'sk1' }), item('Tights', { id: 't1' })], warmth: 0, wind: 0, meetsTarget: true };
    const useCounts = new Map([['t1', 2]]);
    expect(freshnessPenalty(outfit, useCounts)).toBe(0);
  });
});

describe('toppedUpForBand', () => {
  it('applies topUpToward to every core outfit for the given band, with no sort applied', () => {
    const skirt = item('Skirt', { id: 'skirt', inferredWarmth: 0 });
    const core = [{ items: [skirt], warmth: 0, wind: 0, meetsTarget: false }];
    const band = { min: 6, max: 10, center: 8 };
    const scarf = item('Scarf', { id: 'scarf', inferredWarmth: 9 });

    const result = toppedUpForBand(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarf] }),
      noDismatches,
      7,
      NO_CEILING,
      0,
      new Map(),
      new Map(),
    );

    expect(result).toHaveLength(1);
    expect(result[0].items.some((i) => i.id === 'scarf')).toBe(true);
  });
});

describe('rankNow', () => {
  it('ranks meetsTarget outfits ahead of non-meetsTarget ones regardless of freshness or distance', () => {
    const valid = { items: [item('Pants', { id: 'valid-bottom' })], warmth: 20, wind: 0, meetsTarget: true };
    const invalidButFresh = { items: [item('Skirt', { id: 'fresh-invalid' })], warmth: 8, wind: 0, meetsTarget: false };
    const band: WarmthBand = { min: 6, max: 10, center: 8 };

    const ranked = rankNow([invalidButFresh, valid], band, new Map());

    expect(ranked[0]).toBe(valid);
  });

  it('among equally-valid outfits, prefers the one whose tracked items are not already in use', () => {
    const usedBottom = item('Pants', { id: 'used-bottom' });
    const freshBottom = item('Pants', { id: 'fresh-bottom' });
    const outfitUsingUsed = { items: [usedBottom], warmth: 5, wind: 0, meetsTarget: true };
    const outfitUsingFresh = { items: [freshBottom], warmth: 9, wind: 0, meetsTarget: true };
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    const useCounts = new Map([['used-bottom', 1]]);

    // outfitUsingFresh (warmth 9, gap 1) is numerically closer to center 8
    // than outfitUsingUsed (warmth 5, gap 3) -- freshness should rank it
    // first regardless, but this also confirms the deliberate case: even
    // if outfitUsingUsed were closer, freshness wins first.
    const ranked = rankNow([outfitUsingUsed, outfitUsingFresh], band, useCounts);

    expect(ranked[0]).toBe(outfitUsingFresh);
  });

  it('falls back to closeness-to-center once freshness is tied', () => {
    const a = { items: [item('Pants', { id: 'a' })], warmth: 9, wind: 0, meetsTarget: true };
    const b = { items: [item('Pants', { id: 'b' })], warmth: 6, wind: 0, meetsTarget: true };
    const band: WarmthBand = { min: 6, max: 10, center: 8 };

    const ranked = rankNow([b, a], band, new Map());

    // a (gap 1) is closer to center 8 than b (gap 2); neither is used yet.
    expect(ranked[0]).toBe(a);
  });

  it('ranks freshness ahead of distance: a fresh outfit farther from center beats a used outfit closer to center', () => {
    const usedCloser = { items: [item('Pants', { id: 'used-item' })], warmth: 8, wind: 0, meetsTarget: true };
    const freshFarther = { items: [item('Pants', { id: 'fresh-item' })], warmth: 5, wind: 0, meetsTarget: true };
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    const useCounts = new Map([['used-item', 1]]);

    // usedCloser: gap 0 (at center), but used (freshness penalty 1)
    // freshFarther: gap 3 (farther from center), but fresh (freshness penalty 0)
    // Freshness tier should rank freshFarther first, even though distance would prefer usedCloser
    const ranked = rankNow([usedCloser, freshFarther], band, useCounts);

    expect(ranked[0]).toBe(freshFarther);
  });
});

describe('bandOrderFor', () => {
  it('puts warmer last at or above the 20°C neutral point (warmthFloor === 0)', () => {
    expect(bandOrderFor(0)).toEqual(['median', 'cooler', 'warmer']);
  });

  it('puts cooler last below the 20°C neutral point (warmthFloor > 0)', () => {
    expect(bandOrderFor(1)).toEqual(['median', 'warmer', 'cooler']);
    expect(bandOrderFor(18)).toEqual(['median', 'warmer', 'cooler']);
  });

  it('agrees with the real thermal.ts boundary: exactly 20°C is on the warm (warmer-last) side', () => {
    expect(warmthFloor(20)).toBe(0);
    expect(bandOrderFor(warmthFloor(20))).toEqual(['median', 'cooler', 'warmer']);
    expect(warmthFloor(19)).toBeGreaterThan(0);
    expect(bandOrderFor(warmthFloor(19))).toEqual(['median', 'warmer', 'cooler']);
  });
});

describe('selectBandedOutfits performance', () => {
  it('completes well within a generous bound even with a wardrobe shaped like the reported flooding bug', () => {
    // Mirrors the real-wardrobe shape that caused ~26,000 candidates to be
    // checked before this fix: many Bottoms, a small number of Tops and
    // Outerwear where one pairing dominates, and enough Shoes/Bags/Belts
    // to multiply out into a large raw combination count.
    const bottoms = Array.from({ length: 15 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 6 }, (_, i) => item('Sweater', { id: `top-${i}`, inferredWarmth: 4 + i }));
    const outerwear = Array.from({ length: 6 }, (_, i) => item('Jacket', { id: `jacket-${i}`, inferredWarmth: 4 + i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const belts = Array.from({ length: 4 }, (_, i) => item('Belt', { id: `belt-${i}`, inferredWarmth: i, hasBeltLoops: true }));
    const bags = Array.from({ length: 8 }, (_, i) => item('Bag', { id: `bag-${i}`, inferredWarmth: i }));
    const candidates = emptyCandidates({ bottoms, tops, outerwear, shoes, belts, bags });
    const bands = splitIntoWarmthBands(0, 40);

    const start = Date.now();
    const results = selectBandedOutfits(candidates, noDismatches, 0, NO_CEILING, 0, bands);
    const elapsedMs = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    // Generous on purpose (a real run should finish in well under 500ms) --
    // this is a regression guard against the flooding class of bug
    // reappearing, not a tight performance budget.
    expect(elapsedMs).toBeLessThan(3000);
  });
});
