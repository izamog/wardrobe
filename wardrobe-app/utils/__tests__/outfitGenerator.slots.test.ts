/** @jest-environment node */
import { generateOutfits, SCARF_REQUIRED_WARMTH_FLOOR } from '../outfitGenerator';
import { pairKey } from '../pairs';
import { emptyCandidates, item, NO_CEILING, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';

beforeEach(() => {
  resetSeq();
});

describe('generateOutfits: scarf required only above the warmth floor threshold', () => {
  it('never includes a scarf below SCARF_REQUIRED_WARMTH_FLOOR, even when one is offered', () => {
    // Bottom counts at 0.6 weight, so it alone can't carry this — Top has to
    // do most of the work, same as it would physically.
    const bottom = item('Pants', { inferredWarmth: 4, inferredWind: 0 });
    const top = item('T-Shirt', { inferredWarmth: 4, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const scarf = item('Scarf', { inferredWarmth: 3, inferredWind: 2 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf] }),
      noDismatches,
      SCARF_REQUIRED_WARMTH_FLOOR - 1,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Scarf')).toBe(false);
  });

  it('requires a scarf at or above the threshold, and fails without a compatible one', () => {
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 0 });
    const top = item('T-Shirt', { inferredWarmth: 3, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 0 });

    const withoutScarf = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      SCARF_REQUIRED_WARMTH_FLOOR,
      NO_CEILING,
      0,
    );
    expect(withoutScarf).toEqual([]);

    const scarf = item('Scarf', { inferredWarmth: 3, inferredWind: 0 });
    const withScarf = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf] }),
      noDismatches,
      SCARF_REQUIRED_WARMTH_FLOOR,
      NO_CEILING,
      0,
    );
    expect(withScarf).toHaveLength(1);
    expect(withScarf[0].some((i) => i.category === 'Scarf')).toBe(true);
  });
});

describe('generateOutfits: belt required only when the chosen bottom has belt loops', () => {
  it('never offers a belt when the bottom has no belt loops', () => {
    const bottom = item('Pants', { hasBeltLoops: false });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const belt = item('Belt');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], belts: [belt] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Belt')).toBe(false);
  });

  it('requires a belt when the bottom has belt loops', () => {
    const bottom = item('Pants', { hasBeltLoops: true });
    const top = item('T-Shirt');
    const shoes = item('Shoes');

    const withoutBelt = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );
    expect(withoutBelt).toEqual([]);

    const belt = item('Belt');
    const withBelt = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], belts: [belt] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );
    expect(withBelt).toHaveLength(1);
    expect(withBelt[0].some((i) => i.category === 'Belt')).toBe(true);
  });

  it('fails when belt loops require a belt but every candidate has incompatible hardware', () => {
    const bottom = item('Pants', { hasBeltLoops: true });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    // A belt's own hardware only matters against another hardware-bearing
    // item (a Bag) — pair it with an incompatible bag to force the clash.
    const belt = item('Belt', { hardwareColor: 'Gold' });
    const bag = item('Bag', { hardwareColor: 'Silver' });

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        belts: [belt],
        bags: [bag],
      }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    // The belt is required and compatible with everything except the bag,
    // and the bag is optional, so a valid outfit still exists without it.
    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Bag')).toBe(false);
    expect(results[0].some((i) => i.category === 'Belt')).toBe(true);
  });
});

describe('generateOutfits: DISMATCH exclusion', () => {
  it('skips a candidate explicitly DISMATCHed against the chosen bottom', () => {
    const bottom = item('Pants');
    const badTop = item('T-Shirt');
    const goodTop = item('Shirt');
    const shoes = item('Shoes');
    const dismatched = new Set([pairKey(bottom.id, badTop.id)]);

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [badTop, goodTop], shoes: [shoes] }),
      dismatched,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === badTop.id)).toBe(false);
    expect(results[0].some((i) => i.id === goodTop.id)).toBe(true);
  });

  it('fails entirely when the only candidate for a required slot is DISMATCHed', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const dismatched = new Set([pairKey(bottom.id, top.id)]);

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatched,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toEqual([]);
  });
});

describe('generateOutfits: does not overdress on a mild day', () => {
  it('picks the lightest sufficient top instead of the heaviest available one', () => {
    const bottom = item('Pants', { inferredWarmth: 0, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const lightTop = item('T-Shirt', { inferredWarmth: 1, inferredWind: 0 });
    const heavyTop = item('Sweater', { inferredWarmth: 8, inferredWind: 1 });

    // Floor 0 (a mild/warm day): the light top alone already clears it, so
    // it — not the heavy sweater — should be chosen.
    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [heavyTop, lightTop], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === lightTop.id)).toBe(true);
    expect(results[0].some((i) => i.id === heavyTop.id)).toBe(false);
  });

  it('still escalates to the heavier top when the light one is not enough', () => {
    const bottom = item('Pants', { inferredWarmth: 0, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const lightTop = item('T-Shirt', { inferredWarmth: 1, inferredWind: 0 });
    const heavyTop = item('Sweater', { inferredWarmth: 8, inferredWind: 1 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [lightTop, heavyTop], shoes: [shoes] }),
      noDismatches,
      6,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === heavyTop.id)).toBe(true);
  });

  it('prefers the most effective outerwear first when a layer actually is needed', () => {
    const bottom = item('Pants', { inferredWarmth: 0, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const top = item('T-Shirt', { inferredWarmth: 1, inferredWind: 0 });
    const lightJacket = item('Jacket', { inferredWarmth: 2, inferredWind: 2 });
    const warmCoat = item('Coat', { inferredWarmth: 8, inferredWind: 6 });

    // 6, not 7: at 7 the Scarf slot itself becomes required (see
    // SCARF_REQUIRED_WARMTH_FLOOR) and this test supplies no scarf candidate.
    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        outerwear: [lightJacket, warmCoat],
      }),
      noDismatches,
      6,
      NO_CEILING,
      5,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === warmCoat.id)).toBe(true);
    expect(results[0].some((i) => i.id === lightJacket.id)).toBe(false);
  });
});
