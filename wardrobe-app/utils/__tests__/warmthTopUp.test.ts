/** @jest-environment node */
import { topUpToward, compatibleTopUpPools } from '../warmthTopUp';
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

  it('adds Tights to fix a failing leg-region floor even when whole-outfit warmth already meets the band center', () => {
    // Regression test: a prior version of topUpToward bailed out immediately
    // whenever core.warmth >= band.center, so Tights -- the only item that
    // can raise legWarmth -- could never be reached to rescue a leg-floor
    // failure once the outfit was "warm enough" overall.
    const skirt = item('Skirt', { inferredWarmth: 2 });
    const top = item('T-Shirt', { inferredWarmth: 10 });
    const core = scored([skirt, top], 8, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    const tights = item('Tights', { inferredWarmth: 5 });

    // warmthFloor 20 -> legTarget 5 (LEG_WARMTH_FLOOR_FRACTION 1/4): skirt's
    // own legWarmth of 2 fails on its own; torsoTarget ~6.67, top's 10
    // passes torso. Region floors as a whole therefore fail on legs only.
    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], tops: [top], tights: [tights] }),
      noDismatches,
      20,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Tights')).toBe(true);
  });

  it('never pushes a within-ceiling core outfit past warmthCeiling, even if the overshoot is closer to band.center', () => {
    const skirt = item('Skirt', { inferredWarmth: 5 });
    const core = scored([skirt], 3, 0);
    const band: WarmthBand = { min: 10, max: 14, center: 12 };
    // Bottom weight 0.6, Scarf weight 0.8 (see WARMTH_REGION_WEIGHT): adding
    // this scarf brings sumWarmth to 5*0.6 + 10*0.8 = 11, over the ceiling
    // of 10, even though 11 is closer to band.center (12) than 3 is.
    const scarf = item('Scarf', { inferredWarmth: 10 });

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarf] }),
      noDismatches,
      7,
      10,
      0,
    );

    expect(result.items.some((i) => i.category === 'Scarf')).toBe(false);
    expect(result.warmth).toBe(core.warmth);
  });

  it('picks the scarf that best fits the gap to band.center, not simply the warmest available one', () => {
    const skirt = item('Skirt', { inferredWarmth: 2 });
    const core = scored([skirt], 1, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    // Scarf weight 0.8 (see WARMTH_REGION_WEIGHT): scarfSmall lands at
    // 1 + 9*0.8 = 8.2 (gap 0.2 from center 8); scarfBig overshoots hugely
    // at 1 + 20*0.8 = 17 (gap 9). The best fit is scarfSmall.
    const scarfSmall = item('Scarf', { id: 'scarf-small', inferredWarmth: 9 });
    const scarfBig = item('Scarf', { id: 'scarf-big', inferredWarmth: 20 });

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarfBig, scarfSmall] }),
      noDismatches,
      7,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.id === 'scarf-small')).toBe(true);
    expect(result.items.some((i) => i.id === 'scarf-big')).toBe(false);
  });

  it('prefers the less-recently-worn of two equally-good scarves', () => {
    const skirt = item('Skirt', { inferredWarmth: 2 });
    const core = scored([skirt], 1, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    const scarfWornRecently = item('Scarf', { id: 'scarf-recent', inferredWarmth: 9 });
    const scarfFresh = item('Scarf', { id: 'scarf-fresh', inferredWarmth: 9 });
    const wornDaysAgo = new Map([['scarf-recent', 1]]);

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarfWornRecently, scarfFresh] }),
      noDismatches,
      7,
      NO_CEILING,
      0,
      wornDaysAgo,
    );

    expect(result.items.some((i) => i.id === 'scarf-fresh')).toBe(true);
    expect(result.items.some((i) => i.id === 'scarf-recent')).toBe(false);
  });
});

describe('compatibleTopUpPools', () => {
  it('excludes scarves/tights incompatible with the core outfit, keeps ones that are', () => {
    const top = item('Shirt');
    const compatibleScarf = item('Scarf', { id: 'compatible' });
    const dismatchedScarf = item('Scarf', { id: 'dismatched' });
    const core = scored([top], 0, 0);
    const dismatched = new Set([[top.id, dismatchedScarf.id].sort().join('|')]);

    const pools = compatibleTopUpPools(
      core,
      emptyCandidates({ tops: [top], scarves: [compatibleScarf, dismatchedScarf] }),
      dismatched,
    );

    expect(pools.scarves.map((i) => i.id)).toEqual(['compatible']);
  });
});

describe('topUpToward with a pools override', () => {
  it('uses the given pools instead of filtering candidates itself', () => {
    // The override pool contains a scarf that isn't even present in
    // `candidates.scarves` at all -- proof the internal filter never runs
    // when pools is given.
    const skirt = item('Skirt', { inferredWarmth: 2 });
    const core = scored([skirt], 1, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    const overrideOnlyScarf = item('Scarf', { id: 'override-only', inferredWarmth: 9 });

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt] }),
      noDismatches,
      7,
      NO_CEILING,
      0,
      new Map(),
      { scarves: [overrideOnlyScarf], tights: [] },
    );

    expect(result.items.some((i) => i.id === 'override-only')).toBe(true);
  });
});
