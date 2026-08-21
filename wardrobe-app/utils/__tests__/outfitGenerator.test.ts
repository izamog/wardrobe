/** @jest-environment node */
import { generateOutfits, sumWarmth, sumWind } from '../outfitGenerator';
import { emptyCandidates, item, NO_CEILING, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';

beforeEach(() => {
  resetSeq();
});

describe('sumWarmth / sumWind: weighted by body region', () => {
  it('weighs a Top item more than a Shoes item with the identical raw score', () => {
    const warmTop = item('T-Shirt', { inferredWarmth: 5 });
    const warmShoes = item('Shoes', { inferredWarmth: 5 });
    expect(sumWarmth([warmTop])).toBeGreaterThan(sumWarmth([warmShoes]));
  });

  it('weighs a Bottom item more than a Shoes item, and less than a Top item, with the same raw score', () => {
    const top = item('T-Shirt', { inferredWind: 4 });
    const bottom = item('Pants', { inferredWind: 4 });
    const shoes = item('Shoes', { inferredWind: 4 });
    expect(sumWind([shoes])).toBeLessThan(sumWind([bottom]));
    expect(sumWind([bottom])).toBeLessThan(sumWind([top]));
  });

  it('a warm pair of boots cannot make up for a cold torso the way an unweighted sum would', () => {
    // Reflects the real complaint: raw scores of 0 (torso) and 10 (boots)
    // averaging out to "5 out of 10 warm" is not what actually happens to a
    // person dressed that way.
    const coldTop = item('T-Shirt', { inferredWarmth: 0 });
    const warmestPossibleShoes = item('Shoes', { inferredWarmth: 10 });
    expect(sumWarmth([coldTop, warmestPossibleShoes])).toBeLessThan(5);
  });
});

describe('generateOutfits: cold start', () => {
  it('generates an outfit from a fresh wardrobe with zero rated pairs, when bounds are trivial', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].map((i) => i.id).sort()).toEqual([bottom.id, shoes.id, top.id].sort());
  });
});

describe('generateOutfits: required slots', () => {
  it('returns nothing when there is no bottom candidate at all', () => {
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const results = generateOutfits(
      emptyCandidates({ tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );
    expect(results).toEqual([]);
  });

  it('returns nothing when there is no top candidate at all', () => {
    const bottom = item('Pants');
    const shoes = item('Shoes');
    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );
    expect(results).toEqual([]);
  });

  it('returns nothing when there is no shoes candidate at all', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );
    expect(results).toEqual([]);
  });
});

describe('generateOutfits: bottom is chosen inside the search, not fixed ahead of time', () => {
  it('prefers the lightest bottom that still clears the floor, same as any other slot', () => {
    const heavyBottom = item('Pants', { inferredWarmth: 8, inferredWind: 8 });
    const lightBottom = item('Pants', { inferredWarmth: 1, inferredWind: 1 });
    const top = item('T-Shirt', { inferredWarmth: 1 });
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [heavyBottom, lightBottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === lightBottom.id)).toBe(true);
    expect(results[0].some((i) => i.id === heavyBottom.id)).toBe(false);
  });

  it('falls through to the next-lightest bottom when the lightest alone exceeds the ceiling', () => {
    const tooWarmBottom = item('Pants', { inferredWarmth: 10 });
    const okBottom = item('Pants', { inferredWarmth: 1 });
    const top = item('T-Shirt', { inferredWarmth: 1 });
    const shoes = item('Shoes');

    // Ceiling of 3: tooWarmBottom's own weighted warmth (10 * 0.6 = 6)
    // already exceeds it before anything else is even added.
    const results = generateOutfits(
      emptyCandidates({ bottoms: [tooWarmBottom, okBottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      3,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === okBottom.id)).toBe(true);
    expect(results[0].some((i) => i.id === tooWarmBottom.id)).toBe(false);
  });

  it('recency (candidate order) is only a tie-break among equally lean bottoms', () => {
    const olderEquallyLean = item('Pants', { inferredWarmth: 2 });
    const newerEquallyLean = item('Pants', { inferredWarmth: 2 });
    const top = item('T-Shirt');
    const shoes = item('Shoes');

    // Candidates arrive newest-first, as they would from the DB query.
    const results = generateOutfits(
      emptyCandidates({
        bottoms: [newerEquallyLean, olderEquallyLean],
        tops: [top],
        shoes: [shoes],
      }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === newerEquallyLean.id)).toBe(true);
  });
});

describe('generateOutfits: the warmth ceiling rejects an overdressed outfit', () => {
  it('rejects an outfit whose weighted warmth exceeds the ceiling', () => {
    const bottom = item('Pants', { inferredWarmth: 8 });
    const top = item('T-Shirt', { inferredWarmth: 8 });
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      3,
      0,
    );

    expect(results).toEqual([]);
  });

  it('accepts the same outfit once the ceiling is raised', () => {
    const bottom = item('Pants', { inferredWarmth: 8 });
    const top = item('T-Shirt', { inferredWarmth: 8 });
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
  });
});

describe('generateOutfits: meeting the warmth/wind floors', () => {
  it('reaches the floor by summing pieces, not any single item alone', () => {
    // Weighted by body region (see REGION_WEIGHT): Bottom counts at 0.6,
    // Shoes at 0.25, so the Top alone cannot carry either floor — every
    // piece has to contribute for this to clear warmth 4 / wind 2.
    const bottom = item('Pants', { inferredWarmth: 2, inferredWind: 1 });
    const top = item('T-Shirt', { inferredWarmth: 3, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 2 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      4,
      NO_CEILING,
      2,
    );

    expect(results).toHaveLength(1);
  });

  it('adds an optional outerwear layer when required slots alone fall short', () => {
    const bottom = item('Pants', { inferredWarmth: 1, inferredWind: 1 });
    const top = item('T-Shirt', { inferredWarmth: 1, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 0 });
    const jacket = item('Jacket', { inferredWarmth: 5, inferredWind: 4 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], outerwear: [jacket] }),
      noDismatches,
      6,
      NO_CEILING,
      4,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === jacket.id)).toBe(true);
  });

  it('prefers the leanest outfit first when the floor is already met without optional slots', () => {
    const bottom = item('Pants', { inferredWarmth: 5, inferredWind: 5 });
    const top = item('T-Shirt', { inferredWarmth: 5, inferredWind: 5 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const jacket = item('Jacket', { inferredWarmth: 5, inferredWind: 5 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], outerwear: [jacket] }),
      noDismatches,
      3,
      NO_CEILING,
      3,
      2,
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should be the lean one: no jacket, since the floor is
    // already met without it.
    expect(results[0].some((i) => i.id === jacket.id)).toBe(false);
  });

  it('returns nothing when no combination reaches the floor', () => {
    const bottom = item('Pants', { inferredWarmth: 0, inferredWind: 0 });
    const top = item('T-Shirt', { inferredWarmth: 1, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      10,
      NO_CEILING,
      10,
    );

    expect(results).toEqual([]);
  });
});
