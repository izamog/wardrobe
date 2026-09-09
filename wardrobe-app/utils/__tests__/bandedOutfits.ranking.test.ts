/** @jest-environment node */
import { bandOrderFor, selectBandedOutfits, toppedUpForBand, freshnessPenalty, rankNow } from '../bandedOutfits';
import { splitIntoWarmthBands } from '../warmthBands';
import type { WarmthBand } from '../warmthBands';
import { emptyCandidates, item, resetSeq, noDismatches, NO_CEILING } from '../outfitGeneratorTestHelpers';
import { warmthFloor } from '../thermal';

beforeEach(() => resetSeq());

describe('selectBandedOutfits with alreadyClaimed', () => {
  it('skips a band\'s own search entirely when 2 already-claimed outfits are tagged to it', () => {
    const claimedOutfit1 = { items: [item('Pants', { id: 'claimed-1' })], warmth: 3, wind: 0, meetsTarget: true, band: 'median' as const };
    const claimedOutfit2 = { items: [item('Pants', { id: 'claimed-2' })], warmth: 3, wind: 0, meetsTarget: true, band: 'median' as const };
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
      new Map(),
      [claimedOutfit1, claimedOutfit2],
    );

    const medianResults = results.filter((o) => o.band === 'median');
    expect(medianResults).toEqual([claimedOutfit1, claimedOutfit2]);
  });

  it('fills only the remaining slot when 1 already-claimed outfit is tagged to a band', () => {
    const claimedOutfit = { items: [item('Pants', { id: 'claimed-1' })], warmth: 3, wind: 0, meetsTarget: true, band: 'median' as const };
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
      new Map(),
      [claimedOutfit],
    );

    const medianResults = results.filter((o) => o.band === 'median');
    expect(medianResults).toHaveLength(2);
    expect(medianResults[0]).toBe(claimedOutfit);
  });

  it('behaves identically to today when alreadyClaimed is omitted', () => {
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const bands = splitIntoWarmthBands(0, 12);

    const withDefault = selectBandedOutfits(emptyCandidates({ bottoms, tops, shoes }), noDismatches, 0, NO_CEILING, 0, bands);
    const withExplicitEmpty = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
      new Map(),
      [],
    );

    expect(withDefault.map((o) => o.items.map((i) => i.id))).toEqual(withExplicitEmpty.map((o) => o.items.map((i) => i.id)));
  });

  it('seeds the reuse tracker so a filled slot respects reuse against an already-claimed outfit\'s tracked items', () => {
    // Only 1 distinct Bottom exists at all -- claiming an outfit using it
    // once must still leave it under the cap-2 hard ceiling across every
    // band's picks, proving alreadyClaimed items count toward the shared
    // reuse budget rather than being invisible to it.
    const claimedOutfit = {
      items: [item('Pants', { id: 'scarce-bottom' }), item('T-Shirt', { id: 'top-a' }), item('Shoes', { id: 'shoes-a' })],
      warmth: 3,
      wind: 0,
      meetsTarget: true,
      band: 'median' as const,
    };
    const scarceBottom = item('Pants', { id: 'scarce-bottom', inferredWarmth: 3 });
    const tops = [item('T-Shirt', { id: 'top-a', inferredWarmth: 3 }), item('T-Shirt', { id: 'top-b', inferredWarmth: 3 })];
    const shoes = [item('Shoes', { id: 'shoes-a' }), item('Shoes', { id: 'shoes-b' })];
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms: [scarceBottom], tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
      new Map(),
      [claimedOutfit],
    );

    const scarceBottomUses = results.filter((o) => o.items.some((i) => i.id === 'scarce-bottom')).length;
    expect(scarceBottomUses).toBeLessThanOrEqual(2);
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

  it('never counts Bag, Belt, or Scarf -- unlimited reuse per direct feedback (a wardrobe may only own one of each)', () => {
    const outfit = {
      items: [
        item('Skirt', { id: 'sk1' }),
        item('Bag', { id: 'b1' }),
        item('Belt', { id: 'bl1' }),
        item('Scarf', { id: 'sc1' }),
      ],
      warmth: 0,
      wind: 0,
      meetsTarget: true,
    };
    const useCounts = new Map([
      ['b1', 5],
      ['bl1', 5],
      ['sc1', 5],
    ]);
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
    // min widened to 4 (was 6) so both warmth 5 and warmth 9 fall inside the
    // band's own range and tie on the new inBand tier -- otherwise warmth 5
    // would fall outside [6,10] and the inBand tier (which now runs before
    // freshness) would decide this case by itself, the same confound fixed
    // in the 'ranks freshness ahead of distance' test above. center moved to
    // 6 (was 8) so outfitUsingUsed (gap 1) is actually CLOSER to center than
    // outfitUsingFresh (gap 3) -- if freshness were removed from the
    // comparator, distance alone would rank outfitUsingUsed first, so this
    // fixture is genuinely load-bearing for proving freshness (not distance)
    // is what decides the outcome below.
    const band: WarmthBand = { min: 4, max: 10, center: 6 };
    const useCounts = new Map([['used-bottom', 1]]);

    // outfitUsingUsed (warmth 5, gap 1) is numerically closer to center 6
    // than outfitUsingFresh (warmth 9, gap 3) -- freshness should still rank
    // outfitUsingFresh first despite being farther from center, proving
    // freshness (not distance) is the deciding tier here.
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
    // min widened to 4 (was 6) so both candidates fall within the band's own
    // range and are tied on the new inBand tier -- otherwise freshFarther's
    // warmth 5 would fall outside [6,10] and the inBand tier (which now runs
    // before freshness) would decide this case instead of freshness, which
    // isn't what this test is about.
    const band: WarmthBand = { min: 4, max: 10, center: 8 };
    const useCounts = new Map([['used-item', 1]]);

    // usedCloser: gap 0 (at center), but used (freshness penalty 1)
    // freshFarther: gap 3 (farther from center), but fresh (freshness penalty 0)
    // Freshness tier should rank freshFarther first, even though distance would prefer usedCloser
    const ranked = rankNow([usedCloser, freshFarther], band, useCounts);

    expect(ranked[0]).toBe(freshFarther);
  });

  it('prefers a candidate within the band\'s own range over a fresher one outside it', () => {
    const inRangeButUsed = { items: [item('Pants', { id: 'in-range' })], warmth: 8, wind: 0, meetsTarget: true };
    const outOfRangeButFresh = { items: [item('Pants', { id: 'out-of-range' })], warmth: 3, wind: 0, meetsTarget: true };
    const band: WarmthBand = { min: 7, max: 9, center: 8 };
    const useCounts = new Map([['in-range', 1]]); // already used once -- not fresh

    const ranked = rankNow([outOfRangeButFresh, inRangeButUsed], band, useCounts);

    expect(ranked[0]).toBe(inRangeButUsed);
  });

  it('still uses freshness as a tiebreak between two otherwise-equal in-band candidates', () => {
    const used = { items: [item('Pants', { id: 'used' })], warmth: 8, wind: 0, meetsTarget: true };
    const fresh = { items: [item('Pants', { id: 'fresh' })], warmth: 8, wind: 0, meetsTarget: true };
    const band: WarmthBand = { min: 7, max: 9, center: 8 };
    const useCounts = new Map([['used', 1]]);

    const ranked = rankNow([used, fresh], band, useCounts);

    expect(ranked[0]).toBe(fresh);
  });

  it('falls back to closeness-to-center when both candidates are outside the band\'s own range (inBand is tied at false)', () => {
    const closer = { items: [item('Pants', { id: 'closer' })], warmth: 6, wind: 0, meetsTarget: true };
    const farther = { items: [item('Pants', { id: 'farther' })], warmth: 2, wind: 0, meetsTarget: true };
    const band: WarmthBand = { min: 7, max: 9, center: 8 };

    const ranked = rankNow([farther, closer], band, new Map());

    expect(ranked[0]).toBe(closer);
  });

  it('prefers a candidate that avoids repeating THIS band\'s own earlier pick, even over one flagged only by another band', () => {
    // Reported bug (Task 4's real-CSV sweep, 0C/cooler band): freshnessPenalty
    // counts uses across ALL bands, blind to which one -- so a candidate that
    // repeats a DIFFERENT band's used item could tie or beat a candidate that
    // repeats THIS band's own first pick, causing a redundant same-band
    // repeat even when a genuinely fresh-for-this-band alternative exists.
    const repeatsOwnPick = { items: [item('Top', { id: 'own-first-pick' })], warmth: 8, wind: 0, meetsTarget: true };
    const freshForThisBand = { items: [item('Top', { id: 'other-band-top' })], warmth: 8, wind: 0, meetsTarget: true };
    const band: WarmthBand = { min: 7, max: 9, center: 8 };
    const useCounts = new Map([['other-band-top', 1]]); // claimed by an earlier band, not this one
    const pickedThisBandIds = new Set(['own-first-pick']); // this band's own first pick

    const ranked = rankNow([repeatsOwnPick, freshForThisBand], band, useCounts, pickedThisBandIds);

    expect(ranked[0]).toBe(freshForThisBand);
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

  it('completes well within a generous bound with a realistic finite ceiling', () => {
    // Mirrors the reported on-device freeze: NO_CEILING (the existing test
    // above) never exercises generateClosestOutfits' pruning at all, since
    // nothing can exceed an infinite ceiling -- this test uses a real,
    // finite ceiling so the prune actually has work to do.
    const bottoms = Array.from({ length: 15 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 6 }, (_, i) => item('Sweater', { id: `top-${i}`, inferredWarmth: 4 + i }));
    const outerwear = Array.from({ length: 6 }, (_, i) => item('Jacket', { id: `jacket-${i}`, inferredWarmth: 4 + i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const belts = Array.from({ length: 4 }, (_, i) => item('Belt', { id: `belt-${i}`, inferredWarmth: i, hasBeltLoops: true }));
    const bags = Array.from({ length: 8 }, (_, i) => item('Bag', { id: `bag-${i}`, inferredWarmth: i }));
    const candidates = emptyCandidates({ bottoms, tops, outerwear, shoes, belts, bags });
    const bands = splitIntoWarmthBands(1, 6);

    const start = Date.now();
    const results = selectBandedOutfits(candidates, noDismatches, 1, 6, 0, bands);
    const elapsedMs = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(3000);
  });
});
