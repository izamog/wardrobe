/** @jest-environment node */
import { outfitsFor } from '../TodayDataContext';
import { emptyCandidates, item, resetSeq } from '../../utils/outfitGeneratorTestHelpers';
import type { TodayCandidates } from '../../services/outfitGenerator';

beforeEach(() => {
  resetSeq();
});

describe('outfitsFor', () => {
  it('falls back to the closest-available outfits once none meet target, rather than showing none', () => {
    // Reported bug: extreme weather (nothing lean enough for a heatwave,
    // nothing warm enough for a cold snap) showed "Nothing meets today's
    // target" and stopped there, even though the search found real,
    // complete outfits -- see TodayOutfits' own doc comment. A floor of 100
    // (deliberately unreachable by this thin fixture) simulates that: real
    // outfits exist, none of them meet it.
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 1 });
    const candidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    // outfitsFor derives its own floor/ceiling/windFloor from feltTempC and
    // windSpeedKph via utils/thermal.ts -- an extreme cold felt temperature
    // is what actually drives the floor past what this thin wardrobe can
    // reach, the same way a real heatwave or cold snap would.
    const result = outfitsFor(candidates, -15, 0);

    expect(result.hasAnyOutfit).toBe(true);
    expect(result.shown.length).toBeGreaterThan(0);
    expect(result.shown.every((outfit) => !outfit.meetsTarget)).toBe(true);
  });

  it('shows meets-target outfits as such when every outfit in a thin wardrobe happens to clear target', () => {
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 1 });
    const candidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    // A mild, easily-clearable target for this same thin wardrobe.
    const result = outfitsFor(candidates, 20, 0);

    expect(result.hasAnyOutfit).toBe(true);
    expect(result.shown.length).toBeGreaterThan(0);
    expect(result.shown.every((outfit) => outfit.meetsTarget)).toBe(true);
  });

  it('does not drop a band member that misses target just because other outfits meet it', () => {
    // Regression test: outfitsFor used to filter the whole flat list down
    // to meets-target-only outfits whenever *any* outfit met target,
    // silently dropping band members that didn't -- typically the warmer
    // band's own picks, since they sit closest to the ceiling. With bands,
    // that's expected, not a bug: a "warmer" pick legitimately missing
    // target is still a real, honestly-labeled option worth showing.
    //
    // Deterministic (not dependent on the random fair-tiebreak shuffle,
    // unlike an earlier version of this test that relied on ceiling-driven
    // scarcity and could flip between shown.length 2-6 run to run): 2 Pants
    // deterministically clear the leg-region floor at this warmthFloor, 2
    // Skirts (warmth 0) deterministically never can. Only 2 x 2 uses = 4
    // valid Pants-based outfit-instances exist, below the 6 slots needed,
    // so at least one band is forced to fall back to an invalid Skirt
    // outfit regardless of how ties elsewhere in the search shuffle.
    const floor = 20; // legTarget = 20 * LEG_WARMTH_FLOOR_FRACTION(1/4) = 5.
    const validPants = [
      item('Pants', { id: 'pants-0', inferredWarmth: 6 }),
      item('Pants', { id: 'pants-1', inferredWarmth: 7 }),
    ];
    const invalidSkirts = [
      item('Skirt', { id: 'skirt-0', inferredWarmth: 0 }),
      item('Skirt', { id: 'skirt-1', inferredWarmth: 0 }),
    ];
    const tops = Array.from({ length: 6 }, (_, i) => item('Sweater', { id: `top-${i}`, inferredWarmth: 15 + i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bags = Array.from({ length: 6 }, (_, i) => item('Bag', { id: `bag-${i}` }));
    const candidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [...validPants, ...invalidSkirts], tops, shoes, bags }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    // feltTempC chosen so warmthFloor(feltTempC) === 20 (see thermal.ts).
    const result = outfitsFor(candidates, 20 - 20 / 1.2, 0);

    const someMeetTarget = result.shown.some((outfit) => outfit.meetsTarget);
    const someDoNot = result.shown.some((outfit) => !outfit.meetsTarget);
    expect(someMeetTarget && someDoNot).toBe(true);
  });

  it('reports no outfit at all when nothing complete exists in the candidate pools', () => {
    const candidates: TodayCandidates = {
      candidates: emptyCandidates(),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    const result = outfitsFor(candidates, 20, 0);

    expect(result.hasAnyOutfit).toBe(false);
    expect(result.shown).toHaveLength(0);
  });
});

describe('outfitsFor workAppropriateOnly', () => {
  it('excludes items not marked work appropriate when the filter is on', () => {
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2, isWorkAppropriate: true });
    const casualTop = item('T-Shirt', { inferredWarmth: 2, inferredWind: 1 });
    const workTop = item('Shirt', { id: 'work-top', inferredWarmth: 2, inferredWind: 1, isWorkAppropriate: true });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 1, isWorkAppropriate: true });
    const candidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [casualTop, workTop], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    const result = outfitsFor(candidates, 20, 0, true);

    expect(result.hasAnyOutfit).toBe(true);
    expect(result.shown.every((outfit) => outfit.items.every((i) => i.isWorkAppropriate))).toBe(true);
    expect(result.shown.some((outfit) => outfit.items.some((i) => i.id === 'work-top'))).toBe(true);
  });

  it('reports no outfit when nothing in the wardrobe is marked work appropriate', () => {
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 1 });
    const candidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    expect(outfitsFor(candidates, 20, 0, true).hasAnyOutfit).toBe(false);
    // Confirms the filter is what's excluding them, not some other change --
    // the same wardrobe builds a real outfit with the filter off.
    expect(outfitsFor(candidates, 20, 0, false).hasAnyOutfit).toBe(true);
  });
});

describe('outfitsFor threads wornDaysAgo into selectBandedOutfits', () => {
  it('passes todayCandidates.wornDaysAgo through', () => {
    const wornBag = item('Bag', { id: 'worn-bag' });
    const freshBag = item('Bag', { id: 'fresh-bag' });
    const todayCandidates: TodayCandidates = {
      candidates: emptyCandidates({
        bottoms: [item('Pants')],
        tops: [item('T-Shirt')],
        shoes: [item('Shoes')],
        bags: [wornBag, freshBag],
      }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map([['worn-bag', 1]]),
    };

    const result = outfitsFor(todayCandidates, 20, 0);

    const withFreshBag = result.shown.some((outfit) => outfit.items.some((i) => i.id === 'fresh-bag'));
    expect(withFreshBag).toBe(true);
  });
});

describe('outfitsFor banded recommendations', () => {
  it('returns up to 6 outfits spanning cooler/median/warmer, not ranked against one single target', () => {
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i * 2 }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const todayCandidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms, tops, shoes }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    const result = outfitsFor(todayCandidates, 10, 0);

    expect(result.shown.length).toBeGreaterThan(0);
    expect(result.shown.length).toBeLessThanOrEqual(6);
  });
});
