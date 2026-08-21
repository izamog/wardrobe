/** @jest-environment node */
import {
  generateClosestOutfits,
  generateOutfits,
  MAX_SLOT_CANDIDATES,
  sumWarmth,
  sumWind,
  SCARF_REQUIRED_WARMTH_FLOOR,
} from '../outfitGenerator';
import { pairKey } from '../pairs';
import { emptyCandidates, item, NO_CEILING, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';

beforeEach(() => {
  resetSeq();
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
