/** @jest-environment node */
import {
  generateClosestOutfits,
  generateOutfits,
  MAX_SLOT_CANDIDATES,
  sumWarmth,
  sumWind,
  SCARF_PREFERRED_WARMTH_FLOOR,
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

describe('generateClosestOutfits: prefers the warmer of two equally-valid outfits when warmth is needed', () => {
  it('picks a T-Shirt over an equally-valid but colder sleeveless Top, once real warmth is needed', () => {
    // Reported bug: at -14°C, a sleeveless (0 warmth) top was recommended
    // over a T-Shirt the closet also had, even though both, layered under
    // the same Cardigan, cleared every bound equally (tied at distance 0).
    // leanFirst tries the sleeveless top first (it's lighter), and with no
    // tie-break beyond distance, that search-encounter order is what won —
    // every time, regardless of which alternative was actually warmer.
    const bottom = item('Pants', { inferredWarmth: 6, inferredWind: 0 });
    const sleevelessTop = item('Top', { sleeveLength: 'Sleeveless', inferredWarmth: 0, inferredWind: 0 });
    const tshirt = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });
    const cardigan = item('Cardigan', { inferredWarmth: 7, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [sleevelessTop, tshirt, cardigan], shoes: [shoes] }),
      noDismatches,
      10,
      NO_CEILING,
      0,
      10,
    );

    const best = results[0];
    expect(best.meetsTarget).toBe(true);
    expect(best.items.some((i) => i.category === 'T-Shirt')).toBe(true);
    expect(best.items.some((i) => i.category === 'Top')).toBe(false);
  });

  it('still prefers the leaner outfit when no extra warmth is needed at all', () => {
    const bottom = item('Pants', { inferredWarmth: 0, inferredWind: 0 });
    const sleevelessTop = item('Top', { inferredWarmth: 0, inferredWind: 0 });
    const tshirt = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [sleevelessTop, tshirt], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
    );

    expect(results[0].items.some((i) => i.category === 'Top')).toBe(true);
  });
});

describe('generateClosestOutfits', () => {
  it('ranks a near-miss above a further miss, closest first', () => {
    const bottom = item('Pants');
    const coldTop = item('T-Shirt', { inferredWarmth: 1 });
    const warmerTop = item('Sweater', { inferredWarmth: 4 });
    const shoes = item('Shoes');

    // Floor of 5: the bare Pants (0 warmth) keeps every combination here
    // short of the leg floor regardless of the top, so this is still a
    // near-miss either way — but layering the T-Shirt underneath the
    // Sweater (see baseLayerCandidates in outfitCandidatePools.ts) reaches
    // the *torso* sum the floor asks for (4 + 1 = 5) where the Sweater alone
    // could not, which is the combination this now ranks closest.
    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [coldTop, warmerTop], shoes: [shoes] }),
      noDismatches,
      5,
      NO_CEILING,
      0,
    );

    expect(results[0].items.map((i) => i.category)).toContain('Sweater');
    expect(results[0].items.map((i) => i.category)).toContain('T-Shirt');
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

    // Kept below SCARF_PREFERRED_WARMTH_FLOOR: at or above it a Scarf becomes
    // a required slot, and this candidate pool has none, which would make
    // every outfit — not just this one — impossible to build at all.
    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      SCARF_PREFERRED_WARMTH_FLOOR - 1,
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

  it('never ranks a bagless twin of the same outfit alongside the one that wore a compatible bag', () => {
    // Regression: TodayScreen's displayed recommendations come from this
    // function (see outfitsFor in screens/TodayScreen.tsx), not
    // generateOutfits -- a "best match" and "runner up" that differed only by
    // a bag was this exact bug, one combination producing two ranked
    // results instead of one.
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bag = item('Bag');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [bag] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
    );

    expect(results).toHaveLength(1);
    expect(results[0].items.some((i) => i.category === 'Bag')).toBe(true);
  });

  it('does not let a ceiling-busting Tights candidate suppress an otherwise valid tights-free outfit', () => {
    // Regression: unlike Bag (always 0 warmth/wind), Tights carries a real
    // warmth score -- a compatible pair that happens to push the outfit over
    // the ceiling must not silently hide the without-it outfit that actually
    // meets target. See tryEachCandidate's doc comment.
    const dress = item('Dress', { inferredWarmth: 3, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const tights = item('Tights', { inferredWarmth: 1, inferredWind: 0 });

    // warmthFloor 1, not 0: tights are only ever offered once some warmth is
    // needed (see the "no extra warmth" tights test in outfitGenerator.slots.test.ts).
    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [dress], shoes: [shoes], tights: [tights] }),
      noDismatches,
      1,
      3,
      0,
    );

    const withoutTights = results.find((r) => !r.items.some((i) => i.category === 'Tights'));
    expect(withoutTights).toBeDefined();
    expect(withoutTights?.meetsTarget).toBe(true);

    // The tights-wearing branch is still explored and shown too -- this view
    // exists to show near-misses, not to prune them (see the ceiling-pruning
    // paragraph in generateClosestOutfits' own doc comment).
    const withTights = results.find((r) => r.items.some((i) => i.category === 'Tights'));
    expect(withTights).toBeDefined();
    expect(withTights?.meetsTarget).toBe(false);
  });

  it('ranks a region-floor violation behind a genuine match instead of tying with it at distance 0', () => {
    // Regression: distanceFromBounds used to only compare the outfit's
    // overall warmth/wind totals to the bounds, so a mini skirt plus a
    // sleeveless top -- warm enough only because a heavy coat's own warmth
    // carried the whole total -- could land at the same "distance 0" as a
    // genuinely region-adequate outfit, and the stable sort (bottoms explored
    // leanest-first, so the mini skirt first) could leave the region-floor
    // violation ranked ahead of the real match instead of behind it.
    const miniSkirt = item('Skirt', { inferredWarmth: 0, inferredWind: 0 });
    const sleevelessTop = item('T-Shirt', { inferredWarmth: 0, inferredWind: 0 });
    const trousers = item('Pants', { inferredWarmth: 3, inferredWind: 0 });
    const jumper = item('Sweater', { inferredWarmth: 3, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const coat = item('Coat', { inferredWarmth: 10, inferredWind: 0 });

    const results = generateClosestOutfits(
      emptyCandidates({
        bottoms: [miniSkirt, trousers],
        tops: [sleevelessTop, jumper],
        shoes: [shoes],
        outerwear: [coat],
      }),
      noDismatches,
      8,
      NO_CEILING,
      0,
      10,
    );

    expect(results[0].items.some((i) => i.category === 'Skirt')).toBe(false);
    expect(results[0].meetsTarget).toBe(true);
  });
});

describe('generateClosestOutfits threads wornDaysAgo through to buildSlots', () => {
  it('a recently-worn bag is not the sole bag offered when a fresher one exists', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const wornBag = item('Bag', { id: 'worn-bag' });
    const freshBag = item('Bag', { id: 'fresh-bag' });
    const wornDaysAgo = new Map([['worn-bag', 1]]);

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [wornBag, freshBag] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      100,
      wornDaysAgo,
    );

    const withFreshBag = results.some((outfit) => outfit.items.some((i) => i.id === 'fresh-bag'));
    expect(withFreshBag).toBe(true);
  });
});
