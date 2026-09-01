/** @jest-environment node */
import { coreOutfitsForBands, selectBandedOutfits } from '../bandedOutfits';
import { splitIntoWarmthBands } from '../warmthBands';
import { emptyCandidates, item, resetSeq, noDismatches, NO_CEILING } from '../outfitGeneratorTestHelpers';

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
});
