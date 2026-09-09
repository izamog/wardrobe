/** @jest-environment node */
import { bandOrderFor, coreOutfitsForBands, selectBandedOutfits, toppedUpForBand, freshnessPenalty, rankNow } from '../bandedOutfits';
import { splitIntoWarmthBands } from '../warmthBands';
import type { WarmthBand } from '../warmthBands';
import { emptyCandidates, item, resetSeq, noDismatches, NO_CEILING } from '../outfitGeneratorTestHelpers';
import { warmthFloor } from '../thermal';

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

  it('the merged anchor pool is wide enough that a mid-range item is not crowded out by many competing bottoms', () => {
    // Reported bug: with only MAX_SLOT_CANDIDATES (6) candidates per band
    // (3 leanest + 3 warmest-under-ceiling), a genuinely good mid-range
    // fit could be silently excluded from the entire search once enough
    // OTHER bottoms compete for those few slots -- not because it was a
    // poor match, but because too many other items crowded the fixed
    // slice. 30 bottoms spread across the warmth range, only one of which
    // (warmth 12) is the specific mid-range item under test; the other 29
    // are deliberately spread to contest both the leanest and warmest ends.
    //
    // Task 3c note: the original fixture here mirrored `30 - i`, which
    // incidentally duplicated the mid-range item's own warmth (12) onto two
    // of the "other" bottoms. That duplicate was invisible under the old
    // leanest/warmest split (its 3 independent per-band shuffles gave the
    // real target item a ~96% chance of surviving into at least one), but
    // mergedByBandCenters now samples the full range only ONCE (see
    // evenlySampled) -- with a genuine 3-way tie at the sampled index, which
    // of the tied items is kept is decided by evenlySampled's own fair
    // (random) tiebreak, so this test became flaky (~35% pass) for a
    // reason that has nothing to do with crowding, the actual thing under
    // test. 12 low values (0-11) and 17 high values (13-29), with no other
    // item at exactly 12, keeps the crowding intent (many bottoms contest
    // both ends) while making the mid-range item's own position in the
    // sorted range unique and deterministic again.
    //
    // Task 3d note: evenlySampled's fixed even-spacing grid was replaced
    // with jittered stratified sampling (see evenlySampled's own doc
    // comment). For this fixture (30-item pool sampled to
    // BAND_POOL_SLOT_SIZE=15), every bucket is exactly size 2, and the
    // mid-range item's sorted index (12) falls in one of them -- so a
    // single call now only surfaces it ~50% of the time, a property of
    // jittered sampling itself, not a regression of the crowding fix under
    // test. Repeated trials with headroom below the ~50% expected rate
    // distinguish "sometimes not sampled" (fine) from "never sampled"
    // (the actual crowding bug).
    const midRangeBottom = item('Pants', { id: 'mid-range', inferredWarmth: 12 });
    const otherBottoms = [
      ...Array.from({ length: 12 }, (_, i) => item('Pants', { id: `low-${i}`, inferredWarmth: i })),
      ...Array.from({ length: 17 }, (_, i) => item('Pants', { id: `high-${i}`, inferredWarmth: i + 13 })),
    ];
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bands = splitIntoWarmthBands(0, 20);

    let hits = 0;
    for (let trial = 0; trial < 100; trial++) {
      const results = coreOutfitsForBands(
        emptyCandidates({ bottoms: [midRangeBottom, ...otherBottoms], tops: [top], shoes: [shoes] }),
        noDismatches,
        0,
        NO_CEILING,
        0,
        bands,
      );
      const usedIds = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
      if (usedIds.has('mid-range')) hits++;
    }

    expect(hits).toBeGreaterThan(20); // ~50 expected from a size-2 bucket; well above 0, which would mean genuine crowding
  });

  it('a mid-warmth bottom is not excluded by a ceiling scaled with the wrong constant', () => {
    // Reported bug (Task 3's real-CSV finding): mergedByBandCenters scaled
    // warmthCeiling by LEG_WARMTH_FLOOR_FRACTION (0.25, a floor-only
    // constant) instead of the region's real WARMTH_REGION_WEIGHT (Bottom:
    // 0.6). At ceiling 6, the old formula produced a scaled ceiling of 1.5,
    // wrongly excluding a raw-warmth-4 item whose true weighted
    // contribution (4 * 0.6 = 2.4) is well under 6. 10 leaner competing
    // bottoms push the target out of the "leanest" half of the pool split,
    // isolating this from Task 2's slot-widening fix -- this test fails
    // even with BAND_POOL_SLOT_SIZE=15 unless the ceiling scaling itself is
    // also fixed.
    const target = item('Pants', { id: 'mid-warmth', inferredWarmth: 4 });
    const leanerBottoms = [0, 0, 0, 1, 1, 2, 2, 3, 3, 3].map((w, i) =>
      item('Pants', { id: `lean-${i}`, inferredWarmth: w }),
    );
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bands = splitIntoWarmthBands(1, 6);

    const results = coreOutfitsForBands(
      emptyCandidates({ bottoms: [target, ...leanerBottoms], tops: [top], shoes: [shoes] }),
      noDismatches,
      1,
      6,
      0,
      bands,
    );

    const usedIds = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
    expect(usedIds.has('mid-warmth')).toBe(true);
  });

  it('the merged pool evenly covers the full range, not just the two extremes', () => {
    // Reported bug (Task 3b's real-CSV finding): the old leanest-half +
    // warmest-half split structurally excluded any item sitting in the
    // middle of the pool's insulation range once the pool size (20 here)
    // exceeded BAND_POOL_SLOT_SIZE (15) by enough that neither bucket, nor
    // the single per-band closestToFloor pick, ever reached it -- exactly
    // what happened to a real silk skirt (Arket, insulation 6 in an
    // 18-item real pool). 20 bottoms spread evenly across the full warmth
    // range 0-19; the target (warmth 10) sits squarely in the middle,
    // structurally between the old split's leanest-8 (0-7) and
    // warmest-7 (13-19) buckets.
    //
    // Task 3d note: evenlySampled's fixed even-spacing grid was replaced
    // with jittered stratified sampling (see evenlySampled's own doc
    // comment). For this fixture (n=20, slotSize=15), the target's sorted
    // index (10) falls in the bucket spanning indices 10-11 -- a size-2
    // bucket, so a single call now only surfaces it ~50% of the time. That
    // is the jitter working as intended (no permanent structural blind
    // spot), not a regression of the full-range-coverage fix under test.
    // Repeated trials with headroom below the ~50% expected rate
    // distinguish "sometimes not sampled" (fine) from "never sampled"
    // (the actual two-extremes bug).
    const target = item('Pants', { id: 'mid-range', inferredWarmth: 10 });
    const others = Array.from({ length: 19 }, (_, i) => {
      const w = i < 10 ? i : i + 1; // 0..9, 11..19 -- skips 10, the target's own value
      return item('Pants', { id: `other-${i}`, inferredWarmth: w });
    });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bands = splitIntoWarmthBands(1, 20);

    let hits = 0;
    for (let trial = 0; trial < 100; trial++) {
      const results = coreOutfitsForBands(
        emptyCandidates({ bottoms: [target, ...others], tops: [top], shoes: [shoes] }),
        noDismatches,
        1,
        NO_CEILING,
        0,
        bands,
      );
      const usedIds = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
      if (usedIds.has('mid-range')) hits++;
    }

    expect(hits).toBeGreaterThan(20); // ~50 expected from a size-2 bucket; well above 0, which would mean genuine two-extremes exclusion
  });

  it('no single item is a permanent, structural blind spot across repeated calls', () => {
    // Reported bug (Task 3c's own real-CSV finding): the fixed even-spacing
    // grid always skips the exact same indices for a given (poolSize,
    // slotSize) pair -- reproducing the exact real shape that excluded
    // Arket (an 18-item pool sampled to BAND_POOL_SLOT_SIZE=15, target at
    // sorted index 8, one of the 3 indices [3, 8, 14] the old fixed grid
    // always skipped). Running the same query 100 times should surface the
    // target in a strong majority of runs -- not 0%, which is what the
    // fixed grid guaranteed.
    const target = item('Pants', { id: 'always-skipped-under-fixed-grid', inferredWarmth: 6 });
    const others = [0, 0, 0, 2, 4, 4, 5, 5, 7, 8, 9, 9, 9, 9, 9, 10, 10].map((w, i) =>
      item('Pants', { id: `other-${i}`, inferredWarmth: w }),
    );
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bands = splitIntoWarmthBands(1, 6);

    let hits = 0;
    for (let trial = 0; trial < 100; trial++) {
      const results = coreOutfitsForBands(
        emptyCandidates({ bottoms: [target, ...others], tops: [top], shoes: [shoes] }),
        noDismatches,
        1,
        NO_CEILING,
        0,
        bands,
      );
      const usedIds = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
      if (usedIds.has('always-skipped-under-fixed-grid')) hits++;
    }

    expect(hits).toBeGreaterThan(20); // well above the 0/100 the fixed grid guaranteed; a 2-item bucket gives ~50 expected
  });
});

