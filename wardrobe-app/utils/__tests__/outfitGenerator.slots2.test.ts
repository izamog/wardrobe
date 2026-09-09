/** @jest-environment node */
import { generateClosestOutfits, generateOutfits } from '../outfitGenerator';
import { buildSlots } from '../outfitSlots';
import { pairKey } from '../pairs';
import { emptyCandidates, item, NO_CEILING, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';

beforeEach(() => {
  resetSeq();
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
    // inferredWarmth 4, not 0: high enough to clear the leg-region floor at
    // warmthFloor 6 on its own (see LEG_WARMTH_FLOOR_FRACTION), so this test
    // isolates the escalation it's actually about -- the top, not the leg.
    const bottom = item('Pants', { inferredWarmth: 4, inferredWind: 0 });
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
    // inferredWarmth 4, not 0 -- see the same comment above.
    const bottom = item('Pants', { inferredWarmth: 4, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    // inferredWarmth 2, not 1: high enough to clear the torso-region floor at
    // warmthFloor 6 on its own (see REGION_WARMTH_FLOOR_FRACTION), so this
    // test isolates the outerwear escalation it's actually about.
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });
    const lightJacket = item('Jacket', { inferredWarmth: 2, inferredWind: 2 });
    const warmCoat = item('Coat', { inferredWarmth: 8, inferredWind: 6 });

    // 6, not 7: at 7 the Scarf slot itself becomes required (see
    // SCARF_PREFERRED_WARMTH_FLOOR) and this test supplies no scarf candidate.
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

describe('generateOutfits: a Dress as the anchor', () => {
  it('never requires a top alongside a dress', () => {
    const dress = item('Dress', { inferredWarmth: 3, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [dress], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Top')).toBe(false);
  });

  it('still offers a t-shirt or shirt to layer under the dress when one is compatible', () => {
    const dress = item('Dress', { inferredWarmth: 1, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const tShirt = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [dress], shoes: [shoes], tops: [tShirt] }),
      noDismatches,
      2,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.id === tShirt.id)).toBe(true);
  });

  it('still requires a top for a Pants or Skirt anchor', () => {
    const pants = item('Pants');
    const shoes = item('Shoes');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [pants], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toEqual([]);
  });
});

describe('generateOutfits: a Dress never pairs with a plain Top', () => {
  it('only T-Shirt/Shirt may layer under a Dress, never a plain Top', () => {
    // Reported bug: a plain 'Top' category item (see types/wardrobe.ts --
    // distinct from 'T-Shirt' and 'Shirt') was reaching the Top slot
    // alongside a Dress anchor, which layering.ts's own LAYER_PAIRS table
    // never permits (no ['Top', 'Dress'] entry) -- the outfit generator's
    // search just never checked it. A T-Shirt is offered too, to confirm
    // the fix is a real per-category rule, not the Top slot going empty
    // altogether.
    const dress = item('Dress', { inferredWarmth: 1, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 0, inferredWind: 0 });
    const plainTop = item('Top', { inferredWarmth: 2, inferredWind: 0 });
    const tShirt = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });

    const results = generateOutfits(
      emptyCandidates({ bottoms: [dress], shoes: [shoes], tops: [plainTop, tShirt] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results.some((outfit) => outfit.some((i) => i.id === plainTop.id))).toBe(false);
    expect(results.some((outfit) => outfit.some((i) => i.id === tShirt.id))).toBe(true);
  });
});

describe('generateOutfits: bag is preferred, not required', () => {
  it('includes a compatible bag rather than skipping it', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bag = item('Bag');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [bag] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Bag')).toBe(true);
  });

  it('never returns a bagless twin of the same outfit alongside the one that wore a compatible bag', () => {
    // Regression: a preferred slot used to try every candidate *and then
    // also* the skip branch regardless of whether a candidate succeeded, so
    // one combination of bottom/top/shoes produced two "different" top-level
    // results -- one with the bag, one without -- competing for the same
    // maxResults slots as though they were two outfits to choose between,
    // when only the one wearing the bag was ever meant to be recommended.
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bag = item('Bag');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [bag] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      // A generous maxResults: if the bagless twin still existed, it would
      // show up here even though the single bottom/top/shoes combination
      // only has one bag candidate to offer.
      10,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Bag')).toBe(true);
  });

  it('still produces an outfit without a bag when every bag is incompatible', () => {
    // A DISMATCH is the simplest way to force incompatibility here — any
    // reason isCompatibleWithAll excludes a candidate has the same effect.
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bag = item('Bag');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [bag] }),
      new Set([pairKey(bottom.id, bag.id)]),
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Bag')).toBe(false);
  });
});

describe('generateOutfits: tights are offered with a Skirt or Dress any time extra warmth is needed, and with Pants or Leggings only once it is genuinely cold', () => {
  it('includes tights with a dress when one is compatible and some warmth is needed', () => {
    const dress = item('Dress', { inferredWarmth: 3, inferredWind: 0 });
    const shoes = item('Shoes');
    const tights = item('Tights');

    // warmthFloor 3, not 0: tights are only ever offered once the weather
    // calls for some extra warmth — see the next test. The dress alone
    // carries enough warmth to clear the overall floor and both region
    // floors at this level (see REGION_WARMTH_FLOOR_FRACTION), so this
    // isolates "is tights offered at all" from whether the outfit is warm
    // enough overall.
    const results = generateOutfits(
      emptyCandidates({ bottoms: [dress], shoes: [shoes], tights: [tights] }),
      noDismatches,
      3,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Tights')).toBe(true);
  });

  it('never offers tights at all when no extra warmth is needed, however compatible they are', () => {
    // The reported bug: tights were being recommended on a warm (22°C,
    // warmthFloor 0) day. offerTights in outfitSlots.ts's buildSlots now
    // requires warmthFloor > 0, the same cutoff shoeCandidatesFor already
    // used to drop Sandals.
    const dress = item('Dress');
    const shoes = item('Shoes');
    const tights = item('Tights');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [dress], shoes: [shoes], tights: [tights] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Tights')).toBe(false);
  });

  it('never offers tights alongside pants at an everyday cool floor, even when tights are in the closet', () => {
    const pants = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const tights = item('Tights');

    const results = generateOutfits(
      emptyCandidates({ bottoms: [pants], tops: [top], shoes: [shoes], tights: [tights] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].some((i) => i.category === 'Tights')).toBe(false);
  });

  it('still never offers tights alongside pants right at TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR (5°C) itself', () => {
    // Reported requirement: ordinary trousers are adequate leg coverage on
    // their own at 5°C -- Tights under them should only start once it's
    // colder than that, not at 5°C itself. generateClosestOutfits, not
    // generateOutfits: this asserts what the search offers as a candidate,
    // independent of whether this particular closet is warm enough overall
    // to actually meet the (deliberately high, unmet-on-purpose) floor.
    const pants = item('Pants', { inferredWarmth: 5, inferredWind: 4 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });
    const shoes = item('Shoes');
    const tights = item('Tights');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [pants], tops: [top], shoes: [shoes], tights: [tights] }),
      noDismatches,
      18,
      NO_CEILING,
      0,
      100,
    );

    expect(results.some((outfit) => outfit.items.some((i) => i.category === 'Tights'))).toBe(false);
  });

  it('offers tights alongside pants once it is colder than TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR', () => {
    // Reported requirement: below 5°C, tights should be offered as a real
    // extra layer under trousers.
    const pants = item('Pants', { inferredWarmth: 5, inferredWind: 4 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });
    const shoes = item('Shoes');
    const tights = item('Tights', { inferredWarmth: 3, inferredWind: 0 });

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [pants], tops: [top], shoes: [shoes], tights: [tights] }),
      noDismatches,
      19,
      NO_CEILING,
      0,
      100,
    );

    expect(results.some((outfit) => outfit.items.some((i) => i.category === 'Tights'))).toBe(true);
  });
});

describe('buildSlots threads wornDaysAgo into its candidate-pool calls', () => {
  it('a recently-worn bag sorts behind a not-recently-worn one in the Bag slot', () => {
    const anchor = item('Pants', { hasBeltLoops: false });
    const wornBag = item('Bag', { id: 'worn-bag' });
    const freshBag = item('Bag', { id: 'fresh-bag' });
    const wornDaysAgo = new Map([['worn-bag', 1]]);

    const slots = buildSlots(
      emptyCandidates({ bottoms: [anchor], bags: [wornBag, freshBag] }),
      anchor,
      0,
      false,
      false,
      wornDaysAgo,
    );

    const bagSlot = slots.find((slot) => slot.candidates.some((c) => c.category === 'Bag'));
    expect(bagSlot?.candidates.map((c) => c.id)).toEqual(['fresh-bag', 'worn-bag']);
  });
});
