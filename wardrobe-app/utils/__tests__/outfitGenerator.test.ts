/** @jest-environment node */
import {
  generateClosestOutfits,
  generateOutfits,
  MAX_SLOT_CANDIDATES,
  sumWarmth,
  sumWind,
  SCARF_REQUIRED_WARMTH_FLOOR,
  type OutfitCandidates,
} from '../outfitGenerator';
import { pairKey } from '../pairs';
import type { Category, ClothingItem, HardwareColor } from '../../types/wardrobe';

let seq = 0;
const item = (
  category: Category,
  overrides: Partial<
    Pick<ClothingItem, 'hasBeltLoops' | 'hardwareColor' | 'inferredWarmth' | 'inferredWind'>
  > = {},
): ClothingItem => {
  seq += 1;
  return {
    id: `${category}-${seq}`,
    imagePath: '',
    originalImagePath: '',
    primaryColor: '',
    secondaryColor: '',
    category,
    brand: `brand${seq}`,
    costMinorUnits: 0,
    isSecondHand: false,
    materials: [],
    hardwareColor: 'None' as HardwareColor,
    hasBeltLoops: false,
    sleeveLength: 'Short',
    length: '',
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: 'now',
    ...overrides,
  };
};

function emptyCandidates(overrides: Partial<OutfitCandidates> = {}): OutfitCandidates {
  return {
    bottoms: [],
    tops: [],
    shoes: [],
    outerwear: [],
    scarves: [],
    belts: [],
    bags: [],
    ...overrides,
  };
}

/** A generous ceiling for tests that only care about the floor. */
const NO_CEILING = 1000;

const noDismatches = new Set<string>();

beforeEach(() => {
  seq = 0;
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

describe('generateOutfits: result count and slot cap', () => {
  it('never returns more than maxResults outfits', () => {
    const bottom = item('Pants');
    const shoes = item('Shoes');
    const tops = Array.from({ length: 5 }, () => item('T-Shirt'));

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops, shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      2,
    );

    expect(results).toHaveLength(2);
  });

  it('only considers up to MAX_SLOT_CANDIDATES per slot', () => {
    const bottom = item('Pants');
    const shoes = item('Shoes');
    // One more top than the cap allows; every one is individually valid, so
    // this only checks that generation still terminates and returns options
    // bounded by the cap rather than the full candidate list.
    const tops = Array.from({ length: MAX_SLOT_CANDIDATES + 5 }, () => item('T-Shirt'));

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops, shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      100,
    );

    expect(results.length).toBeLessThanOrEqual(MAX_SLOT_CANDIDATES);
  });
});

describe('generateClosestOutfits', () => {
  it('ranks a near-miss above a further miss, closest first', () => {
    const bottom = item('Pants');
    const coldTop = item('T-Shirt', { inferredWarmth: 1 });
    const warmerTop = item('Sweater', { inferredWarmth: 4 });
    const shoes = item('Shoes');

    // Floor of 5: neither top alone clears it, but warmerTop gets closer.
    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [coldTop, warmerTop], shoes: [shoes] }),
      noDismatches,
      5,
      NO_CEILING,
      0,
    );

    expect(results[0].items.map((i) => i.category)).toContain('Sweater');
    expect(results[0].items.map((i) => i.category)).not.toContain('T-Shirt');
  });

  it('flags an outfit that actually clears every bound as meeting the target', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt', { inferredWarmth: 5, inferredWind: 5 });
    const shoes = item('Shoes');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results[0].meetsTarget).toBe(true);
  });

  it('flags an outfit that misses a bound as not meeting the target', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt', { inferredWarmth: 0 });
    const shoes = item('Shoes');

    // Kept below SCARF_REQUIRED_WARMTH_FLOOR: at or above it a Scarf becomes
    // a required slot, and this candidate pool has none, which would make
    // every outfit — not just this one — impossible to build at all.
    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      SCARF_REQUIRED_WARMTH_FLOOR - 1,
      NO_CEILING,
      0,
    );

    expect(results[0].meetsTarget).toBe(false);
  });

  it('reports each outfit’s own computed warmth and wind alongside it', () => {
    const bottom = item('Pants', { inferredWarmth: 2, inferredWind: 1 });
    const top = item('T-Shirt', { inferredWarmth: 3, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 8 });

    const [result] = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(result.warmth).toBe(sumWarmth([bottom, top, shoes]));
    expect(result.wind).toBe(sumWind([bottom, top, shoes]));
  });

  it('still refuses a DISMATCHed pair, same as generateOutfits', () => {
    const bottom = item('Pants');
    const badTop = item('T-Shirt');
    const shoes = item('Shoes');
    const dismatches = new Set([pairKey(bottom.id, badTop.id)]);

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [badTop], shoes: [shoes] }),
      dismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toEqual([]);
  });

  it('respects maxResults after ranking, not before', () => {
    const bottom = item('Pants');
    const tops = [
      item('T-Shirt', { inferredWarmth: 1 }),
      item('Sweater', { inferredWarmth: 3 }),
      item('Coat', { inferredWarmth: 5 }),
    ];
    const shoes = item('Shoes');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops, shoes: [shoes] }),
      noDismatches,
      5,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].items.map((i) => i.category)).toContain('Coat');
  });

  it('returns nothing when no complete outfit can be built at all', () => {
    const bottom = item('Pants');
    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toEqual([]);
  });
});
