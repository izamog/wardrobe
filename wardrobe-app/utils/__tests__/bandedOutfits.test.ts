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

  it('a thin wardrobe (fewer eligible core outfits than 6 slots) still fills more than the per-band minimum, respecting the max-2 ceiling', () => {
    // 2 bottoms, 2 tops, 2 shoes -- every category caps out at 2 items x 2
    // uses = 4 outfits system-wide, below the full 6, but above what a
    // single band's own 2 slots could hold, so filling past 2 total
    // outfits requires borrowing (or ranking) to reach across bands
    // rather than getting stuck once the first band's own picks are made.
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

    // 2 items x 2 uses = 4 is the true system-wide ceiling for every one of
    // bottoms/tops/shoes here, so the borrowing/ranking path should reach
    // exactly that -- not fewer (getting stuck early) and not more
    // (regression test for a prior bug where a discarded, unshown borrow
    // candidate was still recorded against the reuse tracker, silently
    // tightening the ceiling below what the wardrobe could actually support).
    expect(results.length).toBe(4);
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
    // One dominant Sweater+Jacket pairing, plus exactly 2 genuine
    // alternates (2 more Sweaters, 2 more Jackets -- 3 distinct
    // Sweaters/Jackets total, cap-2 reuse each = 6 Top-slots of total
    // supply, EXACTLY matching the 6 total demand across 3 bands x 2
    // outfits). Tight on purpose, not oversupplied: verified empirically
    // (see task-3-report.md) that with the freshness tier stripped from
    // rankNow (reverting to plain meetsTarget -> distance-to-center, the
    // pre-fix behavior), median and cooler's own pure-distance top picks
    // exhaust the dominant pairing's reuse budget before warmer's turn,
    // dropping warmer to 1 valid pick instead of 2 -- hence asserting
    // exactly 2, not just >0. Earlier fixture attempts: a 2-Sweater/2-Jacket
    // version (the plan's original) was mathematically unsatisfiable even
    // with the real fix (4 Top-slots against 6 demand); a 4-Sweater/4-Jacket
    // version was oversupplied enough (8 slots) that pickUpTo's linear
    // skip-and-continue over violatesUniqueness found a valid fresh entry
    // regardless of sort order, making the freshness tier not load-bearing.
    const dominantTop = item('Sweater', { id: 'dominant-top', inferredWarmth: 10 });
    const dominantJacket = item('Jacket', { id: 'dominant-jacket', inferredWarmth: 10 });
    const altTops = Array.from({ length: 2 }, (_, i) => item('Sweater', { id: `alt-top-${i}`, inferredWarmth: 9 - i }));
    const altJackets = Array.from({ length: 2 }, (_, i) => item('Jacket', { id: `alt-jacket-${i}`, inferredWarmth: 9 - i }));
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
    // warmer (picked last here) should still fill both of its slots with a
    // *meetsTarget* outfit, routed to a still-fresh alternate Sweater/Jacket
    // pairing once the dominant one's reuse budget is claimed -- asserting
    // the exact count (not just >0) is what makes this a real regression
    // guard given the exactly-matching 6-slot supply/6-outfit demand above.
    const warmerPicks = results.filter((o) => o.band === 'warmer');
    expect(warmerPicks.length).toBe(2);
    for (const outfit of warmerPicks) {
      expect(outfit.meetsTarget).toBe(true);
    }
  });

  it('picks cooler last (and warmer gets priority) below the 20°C neutral point', () => {
    // Same tight, exactly-matching-supply-and-demand item-count shape as
    // the "picks warmer last" test above (3 distinct Sweaters/Jackets,
    // cap-2 reuse each = exactly 6 Top-slots of supply against exactly 6
    // total demand) -- see that test's comment and task-3-report.md for
    // the full rationale and the fixture attempts this replaces. Uses
    // different warmth values (12/11/9 instead of 10/9/8) and a different
    // band range (5-35 instead of 0-30) than that test: verified
    // empirically to be the specific combination where this fixture shape
    // is actually load-bearing for cooler (with the freshness tier
    // stripped, cooler drops to 1 valid pick instead of 2) rather than for
    // warmer.
    const dominantTop = item('Sweater', { id: 'dominant-top', inferredWarmth: 12 });
    const dominantJacket = item('Jacket', { id: 'dominant-jacket', inferredWarmth: 12 });
    const altTops = [11, 9].map((w, i) => item('Sweater', { id: `alt-top-${i}`, inferredWarmth: w }));
    const altJackets = [11, 9].map((w, i) => item('Jacket', { id: `alt-jacket-${i}`, inferredWarmth: w }));
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
