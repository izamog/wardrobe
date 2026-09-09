/** @jest-environment node */
import { generateOutfits, SCARF_PREFERRED_WARMTH_FLOOR } from '../outfitGenerator';
import { floorAwareCandidates } from '../outfitCandidatePools';
import { pairKey } from '../pairs';
import { emptyCandidates, item, NO_CEILING, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';

beforeEach(() => {
  resetSeq();
});

describe('generateOutfits: scarf required only above the warmth floor threshold', () => {
  it('never includes a scarf below SCARF_PREFERRED_WARMTH_FLOOR, even when one is offered', () => {
    // Bottom counts at 0.6 weight, so it alone can't carry this — Top has to
    // do most of the work, same as it would physically.
    const bottom = item('Pants', { inferredWarmth: 4, inferredWind: 0 });
    const top = item('T-Shirt', { inferredWarmth: 4, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const scarf = item('Scarf', { inferredWarmth: 3, inferredWind: 2 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf] }),
      noDismatches,
      SCARF_PREFERRED_WARMTH_FLOOR - 1,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Scarf')).toBe(false);
  });

  it('adds a scarf at or above the threshold to reach a floor the rest cannot alone', () => {
    // Preferred, not required (see SCARF_PREFERRED_WARMTH_FLOOR): without a
    // scarf in the closet at all, the rest of the outfit still isn't warm
    // enough on its own, so no outfit is offered -- but it's the warmth
    // shortfall that fails it, not scarf's absence specifically.
    const bottom = item('Pants', { inferredWarmth: 4, inferredWind: 0 });
    const top = item('T-Shirt', { inferredWarmth: 3, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 0 });

    const withoutScarf = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      SCARF_PREFERRED_WARMTH_FLOOR,
      NO_CEILING,
      0,
    );
    expect(withoutScarf).toEqual([]);

    const scarf = item('Scarf', { inferredWarmth: 3, inferredWind: 0 });
    const withScarf = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf] }),
      noDismatches,
      SCARF_PREFERRED_WARMTH_FLOOR,
      NO_CEILING,
      0,
    );
    expect(withScarf).toHaveLength(1);
    expect(withScarf[0].some((i) => i.category === 'Scarf')).toBe(true);
  });

  it('still produces an outfit without a scarf when none is compatible, above the threshold', () => {
    // The real bug this guards against: a wardrobe with no scarf at all used
    // to fail every branch outright once the floor crossed
    // SCARF_PREFERRED_WARMTH_FLOOR, however warm the rest of the outfit was.
    const bottom = item('Pants', { inferredWarmth: 8, inferredWind: 0 });
    const top = item('T-Shirt', { inferredWarmth: 8, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 0 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      SCARF_PREFERRED_WARMTH_FLOOR,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Scarf')).toBe(false);
  });

  it('falls back to skipping a compatible scarf when it dooms a required slot further down the branch', () => {
    // Regression: a preferred slot's skip branch must depend on whether
    // wearing the candidate actually led to a *complete* outfit, not merely
    // on local compatibility at the scarf slot itself. Here the scarf is
    // perfectly compatible on its own, but the only belt is DISMATCHed
    // against it -- with the belt required (the bottom has belt loops), that
    // makes every branch that wears this scarf fail outright, downstream of
    // the scarf slot's own check. The search must still find the belted,
    // scarf-less outfit instead of giving up because *a* scarf fit here.
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 0, hasBeltLoops: true });
    const top = item('Sweater', { inferredWarmth: 7, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const scarf = item('Scarf', { inferredWarmth: 1, inferredWind: 0 });
    const belt = item('Belt');

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        scarves: [scarf],
        belts: [belt],
      }),
      new Set([pairKey(scarf.id, belt.id)]),
      SCARF_PREFERRED_WARMTH_FLOOR,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Scarf')).toBe(false);
    expect(results[0].some((i) => i.category === 'Belt')).toBe(true);
  });
});

describe('generateOutfits: a Cardigan is always layered over a real base', () => {
  it('never recommends a Cardigan by itself, with no T-Shirt, Top, Shirt, Sweater or Dress underneath', () => {
    // Reported bug: a Cardigan was being recommended as the outfit's only
    // torso covering. baseTopCandidates (outfitCandidatePools.ts) excludes
    // Cardigan from the required Top slot's own pool, so it can only ever
    // come from its own, separate, optional slot in buildSlots.
    const bottom = item('Pants');
    const cardigan = item('Cardigan');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [cardigan], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toEqual([]);
  });

  it('layers a Cardigan over a T-Shirt when one is available', () => {
    const bottom = item('Pants');
    const tshirt = item('T-Shirt');
    const cardigan = item('Cardigan');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [tshirt, cardigan], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
    );

    expect(results.some((outfit) => outfit.some((i) => i.category === 'Cardigan'))).toBe(true);
    expect(
      results.every(
        (outfit) => !outfit.some((i) => i.category === 'Cardigan') || outfit.some((i) => i.category === 'T-Shirt'),
      ),
    ).toBe(true);
  });

  it('layers a Cardigan over a Dress when no separate Top is offered', () => {
    // Cardigan's own slot is optional, not preferred (see buildSlots), so it
    // tries being skipped first — maxResults 10, not 1, so the
    // cardigan-included branch is still reached and not cut off by the bare
    // dress-alone result being found first.
    const dress = item('Dress');
    const cardigan = item('Cardigan');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [dress], tops: [cardigan], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
    );

    const withCardigan = results.find((outfit) => outfit.some((i) => i.category === 'Cardigan'));
    expect(withCardigan).toBeDefined();
    expect(withCardigan?.some((i) => i.category === 'Dress')).toBe(true);
  });

  it('layers a Cardigan over a Shirt', () => {
    // Explicitly asked for: a Cardigan over a T-Shirt, Top, Shirt or Dress.
    const bottom = item('Pants');
    const shirt = item('Shirt');
    const cardigan = item('Cardigan');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [shirt, cardigan], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
    );

    const withCardigan = results.find((outfit) => outfit.some((i) => i.category === 'Cardigan'));
    expect(withCardigan).toBeDefined();
    expect(withCardigan?.some((i) => i.category === 'Shirt')).toBe(true);
  });

  it('never pairs a Cardigan directly with a Sweater, even when both are compatible slots', () => {
    // See CARDIGAN_INCOMPATIBLE_LAYERS in pairs.ts: two knit mid-layers
    // stacked on the torso is the one combination excluded, in either order.
    const bottom = item('Pants');
    const sweater = item('Sweater');
    const cardigan = item('Cardigan');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [sweater, cardigan], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
    );

    expect(results.every((outfit) => !outfit.some((i) => i.category === 'Cardigan'))).toBe(true);
  });

  it('never puts a Cardigan over more than one other torso layer', () => {
    // Reported bug: a Cardigan, Shirt and T-Shirt together — two layers
    // underneath the Cardigan, not one. The Base Layer slot (T-Shirt, see
    // baseLayerCandidates in outfitCandidatePools.ts) can legitimately add
    // an extra layer under a Shirt or Sweater when no Cardigan is involved;
    // it's only once a Cardigan is also present that a second underlayer
    // stops being allowed — see violatesCardiganLayerLimit in outfitSlots.ts.
    const bottom = item('Pants');
    const shirt = item('Shirt');
    const tshirt = item('T-Shirt');
    const cardigan = item('Cardigan');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [shirt, tshirt, cardigan], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      20,
    );

    for (const outfit of results) {
      const torsoCount = outfit.filter((i) =>
        ['Top', 'T-Shirt', 'Shirt', 'Sweater', 'Cardigan'].includes(i.category),
      ).length;
      if (outfit.some((i) => i.category === 'Cardigan')) {
        expect(torsoCount).toBeLessThanOrEqual(2);
      }
    }
    // The Shirt+T-Shirt combination should still exist somewhere in the
    // results — just never alongside the Cardigan.
    expect(
      results.some(
        (outfit) => outfit.some((i) => i.category === 'Shirt') && outfit.some((i) => i.category === 'T-Shirt'),
      ),
    ).toBe(true);
  });
});

describe('generateOutfits: Shorts are excluded once any extra warmth is needed', () => {
  it('never recommends Shorts once warmthFloor is above 0, however warm the material scores', () => {
    // Reported bug: at a real 10°C felt outfit target (floor 6), denim
    // Shorts scored exactly warmthFloor * REGION_WARMTH_FLOOR_FRACTION (2),
    // clearing meetsLegFloor on a technicality despite being bare-legged.
    // Shorts can never be paired with Tights to make up for that (see
    // offerTights in outfitSlots.ts's buildSlots), so bottomCandidatesFor
    // excludes them outright once warmthFloor > 0, the same way
    // shoeCandidatesFor already excludes Sandals.
    const shorts = item('Shorts', {
      inferredWarmth: 2,
      inferredWind: 0,
    });
    const jeans = item('Pants', { length: 'Long', inferredWarmth: 6, inferredWind: 2 });
    const top = item('Sweater', { inferredWarmth: 8, inferredWind: 1 });
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [shorts, jeans], tops: [top], shoes: [shoes] }),
      noDismatches,
      6,
      NO_CEILING,
      0,
      10,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((outfit) => !outfit.some((i) => i.category === 'Shorts'))).toBe(true);
  });

  it('still offers Shorts when no extra warmth is needed at all', () => {
    const shorts = item('Shorts', { inferredWarmth: 2, inferredWind: 0 });
    const top = item('T-Shirt');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [shorts], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Shorts')).toBe(true);
  });
});

describe('generateOutfits: Sleeveless items are excluded once any extra warmth is needed', () => {
  it('never recommends a Sleeveless top, however much warmth is layered over it', () => {
    // Reported bug: a sleeveless top layered under a Cardigan and Coat was
    // recommended at -14°C — the outfit's *total* warmth cleared the bounds
    // on the strength of the layers over it, and meetsTorsoFloor can be
    // satisfied the same way, so nothing about the region-floor check ever
    // depended on the base layer itself providing any warmth. A sleeveless
    // base is bare skin at the point closest to the body regardless of what
    // covers it, which excludesSleeveless (outfitCandidatePools.ts) now
    // rules out directly, the same way Sandals and Shorts already are.
    const bottom = item('Pants', { inferredWarmth: 6, inferredWind: 0 });
    const sleevelessTop = item('Top', { sleeveLength: 'Sleeveless', inferredWarmth: 0, inferredWind: 0 });
    const cardigan = item('Cardigan', { inferredWarmth: 7, inferredWind: 0 });
    const coat = item('Coat', { inferredWarmth: 10, inferredWind: 6 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [sleevelessTop, cardigan],
        outerwear: [coat],
        shoes: [shoes],
      }),
      noDismatches,
      16,
      NO_CEILING,
      0,
      10,
    );

    expect(results.every((outfit) => !outfit.some((i) => i.sleeveLength === 'Sleeveless'))).toBe(true);
  });

  it('still offers a Sleeveless top when no extra warmth is needed at all', () => {
    const bottom = item('Pants');
    const sleevelessTop = item('Top', { sleeveLength: 'Sleeveless' });
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [sleevelessTop], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.sleeveLength === 'Sleeveless')).toBe(true);
  });
});

describe('generateOutfits: floor-aware candidate selection', () => {
  it('still finds a warm sweater and jeans when the closet holds many lighter tops and bottoms', () => {
    // The reported bug: at a cold floor, only sleeveless tops and light
    // skirts were ever recommended, never a sweater, jeans or coat. leanFirst
    // used to sort every slot's candidates lightest-first and hard-cap at
    // MAX_SLOT_CANDIDATES *before* any weather check ran — with 8 lighter
    // tops and bottoms in the closet below, the sweater and jeans never
    // entered the candidate pool at all, regardless of what warmthFloor
    // needed. floorAwareCandidates (outfitSlots.ts) fixes this by always
    // keeping some candidates that can independently clear the region floor,
    // alongside the leanest ones.
    const lightTops = Array.from({ length: 8 }, () => item('T-Shirt', { inferredWarmth: 0, inferredWind: 0 }));
    const sweater = item('Sweater', { inferredWarmth: 8, inferredWind: 0 });
    const lightBottoms = Array.from({ length: 8 }, () => item('Skirt', { inferredWarmth: 0, inferredWind: 0 }));
    const jeans = item('Pants', { inferredWarmth: 6, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 0 });

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [...lightBottoms, jeans],
        tops: [...lightTops, sweater],
        shoes: [shoes],
      }),
      noDismatches,
      9,
      NO_CEILING,
      0,
      10,
    );

    expect(results.some((outfit) => outfit.some((i) => i.category === 'Sweater'))).toBe(true);
    expect(results.some((outfit) => outfit.some((i) => i.category === 'Pants'))).toBe(true);
  });

  it('still includes the warmest bottom even once the region target exceeds any single bottom\'s own warmth', () => {
    // Reported bug: at extreme cold, warmthFloor * REGION_WARMTH_FLOOR_FRACTION
    // (the target floorAwareCandidates used to require a bottom to clear on
    // its own) can exceed the warmth any single Bottom item could ever reach
    // -- real leg warmth is bottom-plus-Tights (see legWarmth in
    // outfitScoring.ts), never the bottom alone. Once the target passed that
    // ceiling, the old "sufficient" filter matched nothing and silently fell
    // back to leanFirst -- every candidate offered was one of the lightest in
    // the closet, and a genuinely warmer bottom (jeans, here) never entered
    // the pool at all, however cold it got. floorAwareCandidates now always
    // keeps the warmest available options too, with no threshold to clear.
    const lightSkirts = Array.from({ length: 8 }, () => item('Skirt', { inferredWarmth: 1, inferredWind: 0 }));
    const jeans = item('Pants', { inferredWarmth: 6, inferredWind: 2 });

    // Target = 100/3 ≈ 33.3, comfortably above jeans' own warmth of 6 --
    // nothing could ever be "sufficient" under the old per-item threshold.
    const pool = floorAwareCandidates([...lightSkirts, jeans], 100);

    expect(pool.some((candidate) => candidate.id === jeans.id)).toBe(true);
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

