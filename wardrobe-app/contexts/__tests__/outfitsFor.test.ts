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

  it('shows only meets-target outfits when at least one exists, never mixing in a closest-available one', () => {
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

describe('outfitsFor threads wornDaysAgo into rankedDiverseOutfits', () => {
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
