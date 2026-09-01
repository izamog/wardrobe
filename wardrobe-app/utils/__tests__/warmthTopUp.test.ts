/** @jest-environment node */
import { topUpToward } from '../warmthTopUp';
import { emptyCandidates, item, resetSeq, noDismatches, NO_CEILING } from '../outfitGeneratorTestHelpers';
import type { ScoredOutfit } from '../outfitGenerator';
import type { WarmthBand } from '../warmthBands';

beforeEach(() => resetSeq());

function scored(items: ReturnType<typeof item>[], warmth: number, wind: number, meetsTarget = true): ScoredOutfit {
  return { items, warmth, wind, meetsTarget };
}

describe('topUpToward', () => {
  it('adds a Scarf to close a warmth gap, when one is eligible and compatible', () => {
    const skirt = item('Skirt', { inferredWarmth: 2 });
    const top = item('T-Shirt', { inferredWarmth: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1 });
    const scarf = item('Scarf', { inferredWarmth: 4, inferredWind: 0 });
    const core = scored([skirt, top, shoes], 4, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], tops: [top], shoes: [shoes], scarves: [scarf] }),
      noDismatches,
      7,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Scarf')).toBe(true);
    expect(result.warmth).toBeGreaterThan(core.warmth);
  });

  it('does not add anything when the core outfit already meets or exceeds the band center', () => {
    const skirt = item('Skirt', { inferredWarmth: 8 });
    const core = scored([skirt], 8, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    const scarf = item('Scarf', { inferredWarmth: 4 });

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarf] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(result.items).toHaveLength(core.items.length);
  });

  it('does not add Tights under Pants below TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR, even if warmer tights exist', () => {
    const pants = item('Pants', { inferredWarmth: 2 });
    const core = scored([pants], 2, 0);
    const band: WarmthBand = { min: 3, max: 5, center: 4 };
    const tights = item('Tights', { inferredWarmth: 5 });

    // warmthFloor 5 is below TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR (18) -- tights under Pants are not eligible here.
    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [pants], tights: [tights] }),
      noDismatches,
      5,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Tights')).toBe(false);
  });

  it('never adds a Scarf or Tights that is dismatched against an existing item', () => {
    const top = item('Shirt');
    const scarf = item('Scarf', { id: 'scarf-1', inferredWarmth: 5 });
    const core = scored([top], 0, 0);
    const band: WarmthBand = { min: 4, max: 8, center: 6 };
    const dismatched = new Set([[top.id, scarf.id].sort().join('|')]);

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ tops: [top], scarves: [scarf] }),
      dismatched,
      7,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Scarf')).toBe(false);
  });

  it('tries Scarf alone before Scarf+Tights, stopping as soon as the band center is reached', () => {
    const skirt = item('Skirt', { inferredWarmth: 0 });
    const core = scored([skirt], 0, 0);
    const band: WarmthBand = { min: 3, max: 5, center: 4 };
    const scarf = item('Scarf', { inferredWarmth: 5 });
    const tights = item('Tights', { inferredWarmth: 5 });

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarf], tights: [tights] }),
      noDismatches,
      7,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Scarf')).toBe(true);
    expect(result.items.some((i) => i.category === 'Tights')).toBe(false);
  });
});
