/** @jest-environment node */
import { generateClosestOutfits, generateOutfits, sumWarmth, sumWind } from '../outfitGenerator';
import { emptyCandidates, item, NO_CEILING, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';
import { warmthCeiling, warmthFloor, windFloor } from '../thermal';
import { estimateWarmth, estimateWind } from '../warmth';

beforeEach(() => {
  resetSeq();
});

describe('sumWarmth / sumWind: weighted by body region', () => {
  it('weighs a Top item more than a Shoes item with the identical raw score', () => {
    const warmTop = item('T-Shirt', { inferredWarmth: 5 });
    const warmShoes = item('Shoes', { inferredWarmth: 5 });
    expect(sumWarmth([warmTop])).toBeGreaterThan(sumWarmth([warmShoes]));
  });

  it('counts wind only from outerwear, a bottom (or Dress) and a scarf -- not a Top or Shoes', () => {
    // Only outerwear, the leg layer and a scarf actually shield the wearer
    // from moving air (see WIND_REGION_WEIGHT) -- a Top or Shoes item's own
    // inferredWind describes its own construction, not the outfit's overall
    // wind resistance, so neither counts toward the total at all.
    const top = item('T-Shirt', { inferredWind: 4 });
    const shoes = item('Shoes', { inferredWind: 4 });
    const bottom = item('Pants', { inferredWind: 4 });
    const outerwear = item('Jacket', { inferredWind: 4 });
    const scarf = item('Scarf', { inferredWind: 4 });
    expect(sumWind([top])).toBe(0);
    expect(sumWind([shoes])).toBe(0);
    expect(sumWind([bottom])).toBeGreaterThan(0);
    expect(sumWind([outerwear])).toBeGreaterThan(0);
    expect(sumWind([scarf])).toBeGreaterThan(0);
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
    // With rankWithFairTiebreak, tied items are randomly shuffled, so either
    // item can be selected — the test checks that a valid outfit is found
    // with one of the two equally-warm options.
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
    expect(
      results[0].some((i) => i.id === newerEquallyLean.id || i.id === olderEquallyLean.id),
    ).toBe(true);
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
    // Weighted by body region (see WARMTH_REGION_WEIGHT): Bottom counts at
    // 0.6, Shoes at 0.25, so the Top alone cannot carry the warmth floor —
    // every piece has to contribute for this to clear warmth 4. Wind now
    // only counts outerwear, the bottom and a scarf (see WIND_REGION_WEIGHT),
    // so the bottom alone has to carry the wind floor here.
    const bottom = item('Pants', { inferredWarmth: 2, inferredWind: 4 });
    const top = item('T-Shirt', { inferredWarmth: 3, inferredWind: 0 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 0 });

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
    // Bottom warmth 3 and top warmth 2, not lower: each high enough to clear
    // its own region floor at warmthFloor 6 on its own (see
    // REGION_WARMTH_FLOOR_FRACTION), so this test isolates what it's
    // actually about -- needing the jacket to clear the *overall* warmth and
    // wind floors, not either per-region one.
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 1 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 0 });
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

describe('generateOutfits: regression — a bare mini skirt and sandals at 10°C', () => {
  // Reproduces the reported bug directly: at a real 10°C felt / 7kph outfit
  // target, an all-zero mini skirt + sandals combination used to still clear
  // the (unweighted-per-region) floor on the strength of a warm jacket alone.
  const feltTempC = 10;
  const windSpeedKph = 7;
  const floor = warmthFloor(feltTempC);
  const ceiling = warmthCeiling(feltTempC);
  const wFloor = windFloor(windSpeedKph, feltTempC);

  const miniSkirt = item('Skirt', {
    inferredWarmth: estimateWarmth('Skirt', [], 'Short', 'Mini'),
    inferredWind: estimateWind('Skirt', [], 'Short', 'Mini'),
  });
  const midiSkirt = item('Skirt', {
    inferredWarmth: estimateWarmth('Skirt', ['Merino'], 'Short', 'Midi'),
    inferredWind: estimateWind('Skirt', ['Merino'], 'Short', 'Midi'),
  });
  const sandals = item('Sandals', {
    inferredWarmth: estimateWarmth('Sandals', []),
    inferredWind: estimateWind('Sandals', []),
  });
  const boots = item('Boots', {
    inferredWarmth: estimateWarmth('Boots', []),
    inferredWind: estimateWind('Boots', []),
  });
  // A wool Shirt, not a bare T-Shirt or plain Shirt: a plain T-Shirt's
  // warmth (1) can't clear the torso-region floor on its own at this felt
  // temperature (see REGION_WARMTH_FLOOR_FRACTION) -- exactly the other
  // half of the reported bug, a 0-ish torso layer riding along on the
  // jacket alone. A plain (no-material) Shirt no longer clears it either
  // now that the floor is calibrated higher; Wool's material adjustment is
  // what gets a single base layer there without also busting the ceiling
  // below once the jacket is added.
  const top = item('Shirt', {
    inferredWarmth: estimateWarmth('Shirt', ['Wool']),
    inferredWind: estimateWind('Shirt', ['Wool']),
  });
  const jacket = item('Jacket', {
    inferredWarmth: estimateWarmth('Jacket', []),
    inferredWind: estimateWind('Jacket', []),
  });

  it('finds no outfit when a mini skirt and sandals are the only bottom and shoes on offer', () => {
    const results = generateOutfits(
      emptyCandidates({ bottoms: [miniSkirt], tops: [top], shoes: [sandals], outerwear: [jacket] }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(results).toEqual([]);
  });

  it('finds a valid outfit once a midi skirt and boots are also available, and never reaches for sandals', () => {
    const results = generateOutfits(
      emptyCandidates({
        bottoms: [miniSkirt, midiSkirt],
        tops: [top],
        shoes: [sandals, boots],
        outerwear: [jacket],
      }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(results.length).toBeGreaterThan(0);
    for (const outfit of results) {
      expect(outfit.some((i) => i.id === sandals.id)).toBe(false);
    }
  });
});

describe('generateOutfits: regression — a scarf-less wardrobe still builds an outfit at 6°C', () => {
  // Reproduces the reported bug: at a real 6°C felt / calm target, a closet
  // with no scarf at all (only jeans, a wool jumper, boots and a wool coat)
  // used to find zero outfits, because SCARF_REQUIRED_WARMTH_FLOOR made
  // Scarf a required slot at this floor regardless of what else was
  // available. Scarf is now preferred, not required — see
  // SCARF_PREFERRED_WARMTH_FLOOR.
  it('finds an outfit from jeans, a wool jumper and boots, with no scarf offered', () => {
    const feltTempC = 6;
    const windSpeedKph = 0;
    const floor = warmthFloor(feltTempC);
    const ceiling = warmthCeiling(feltTempC);
    const wFloor = windFloor(windSpeedKph, feltTempC);

    const jeans = item('Pants', {
      inferredWarmth: estimateWarmth('Pants', ['Wool'], 'Short', 'Long'),
      inferredWind: estimateWind('Pants', ['Wool'], 'Short', 'Long'),
    });
    // A wool Sweater and a wool Jacket, not plain (no-material) ones: the
    // higher floor at 6°C (WARMTH_UNITS_PER_DEGREE) needs real insulation
    // from every piece to clear both the outfit total and each region's own
    // share of it (see meetsLegFloor/meetsTorsoFloor in outfitScoring.ts) --
    // a jeans+jumper+boots+jacket outfit with no material adjustments at all
    // no longer reaches either.
    const woolJumper = item('Sweater', {
      inferredWarmth: estimateWarmth('Sweater', ['Wool']),
      inferredWind: estimateWind('Sweater', ['Wool']),
    });
    const boots = item('Boots', {
      inferredWarmth: estimateWarmth('Boots', []),
      inferredWind: estimateWind('Boots', []),
    });
    const woolCoat = item('Jacket', {
      inferredWarmth: estimateWarmth('Jacket', ['Wool']),
      inferredWind: estimateWind('Jacket', ['Wool']),
    });

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [jeans],
        tops: [woolJumper],
        shoes: [boots],
        outerwear: [woolCoat],
      }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(results.length).toBeGreaterThan(0);
  });
});

describe('generateOutfits: regression — a strong gale demands real wind-blocking, not just a jacket', () => {
  // Reproduces the reported bug: at 10°C felt / 80kph (a strong gale), a
  // single jacket used to be enough to clear the wind floor on its own
  // (see the old windFloor formula in utils/thermal.ts), while a bare skirt
  // and sandals sat alongside it. The reworked formula demands close to the
  // maximum wind resistance at this wind speed, which a jacket alone cannot
  // reach — only genuinely wind-blocking outerwear and bottoms together can.
  it('rejects a mid-weight jacket alone, but finds an outfit once a proper coat and jeans are available', () => {
    const feltTempC = 10;
    const windSpeedKph = 80;
    const floor = warmthFloor(feltTempC);
    const ceiling = warmthCeiling(feltTempC);
    const wFloor = windFloor(windSpeedKph, feltTempC);

    const skirt = item('Skirt', {
      inferredWarmth: estimateWarmth('Skirt', [], 'Short', 'Midi'),
      inferredWind: estimateWind('Skirt', [], 'Short', 'Midi'),
    });
    // A wool Shirt, not a bare T-Shirt or a plain Shirt: its higher category
    // baseline plus Wool's material adjustment is what clears the
    // torso-region floor at this felt temperature (see
    // REGION_WARMTH_FLOOR_FRACTION) without adding so much warmth that the
    // jacket-plus-everything-else total busts the ceiling below.
    const top = item('Shirt', {
      inferredWarmth: estimateWarmth('Shirt', ['Wool']),
      inferredWind: estimateWind('Shirt', ['Wool']),
    });
    const woolJacket = item('Jacket', {
      inferredWarmth: estimateWarmth('Jacket', ['Wool'], 'Long'),
      inferredWind: estimateWind('Jacket', ['Wool'], 'Long'),
    });
    const boots = item('Boots', {
      inferredWarmth: estimateWarmth('Boots', []),
      inferredWind: estimateWind('Boots', []),
    });

    const jacketOnly = generateOutfits(
      emptyCandidates({ bottoms: [skirt], tops: [top], shoes: [boots], outerwear: [woolJacket] }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );
    expect(jacketOnly).toEqual([]);

    const jeans = item('Pants', {
      inferredWarmth: estimateWarmth('Pants', ['Denim'], 'Short', 'Long'),
      inferredWind: estimateWind('Pants', ['Denim'], 'Short', 'Long'),
    });
    // Leather and short-sleeved, not Wool/Long: MATERIAL_WIND_ADJUSTMENT gives
    // leather a near-airtight wind adjustment (see utils/warmth.ts) without
    // also driving warmth up to where the ceiling would prune the branch
    // before the wind floor is even checked -- short sleeves shave one more
    // warmth point off for the same reason, now that the torso-region floor
    // needs a real top warm enough to matter on its own too.
    const leatherJacket = item('Jacket', {
      inferredWarmth: estimateWarmth('Jacket', ['Leather'], 'Short'),
      inferredWind: estimateWind('Jacket', ['Leather'], 'Short'),
    });

    const withRealWindGear = generateOutfits(
      emptyCandidates({
        bottoms: [skirt, jeans],
        tops: [top],
        shoes: [boots],
        outerwear: [woolJacket, leatherJacket],
      }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(withRealWindGear.length).toBeGreaterThan(0);
  });
});

describe('generateOutfits: regression — a warm coat cannot mask a bare torso or bare legs at 6°C', () => {
  // Reproduces the reported bug directly: a mini skirt and a sleeveless top,
  // both scoring at or near 0 on their own, summed to a warm-enough outfit
  // total purely on the strength of a heavy wool coat -- "top w0, coat w10"
  // clearing the floor even though neither the legs nor the torso were
  // actually dressed for 6°C. Both region floors (see
  // REGION_WARMTH_FLOOR_FRACTION) now have to be cleared independently of
  // whatever the outerwear layer contributes.
  const feltTempC = 6;
  const windSpeedKph = 0;
  const floor = warmthFloor(feltTempC);
  const ceiling = warmthCeiling(feltTempC);
  const wFloor = windFloor(windSpeedKph, feltTempC);

  const miniSkirt = item('Skirt', {
    inferredWarmth: estimateWarmth('Skirt', [], 'Short', 'Mini'),
    inferredWind: estimateWind('Skirt', [], 'Short', 'Mini'),
  });
  const sleevelessTop = item('T-Shirt', {
    sleeveLength: 'Sleeveless',
    inferredWarmth: estimateWarmth('T-Shirt', [], 'Sleeveless'),
    inferredWind: estimateWind('T-Shirt', [], 'Sleeveless'),
  });
  const shoes = item('Shoes', {
    inferredWarmth: estimateWarmth('Shoes', []),
    inferredWind: estimateWind('Shoes', []),
  });
  // Plain (no-material), not wool-and-Long: with the region floors below
  // already demanding a genuinely warm top and bottom, a wool Coat's own
  // clamped-to-max warmth on top of those busts the ceiling before ever
  // reaching the actual point of this test.
  const woolCoat = item('Coat', {
    inferredWarmth: estimateWarmth('Coat', []),
    inferredWind: estimateWind('Coat', []),
  });

  it('finds no outfit from a bare mini skirt and sleeveless top alone, however warm the coat is', () => {
    const results = generateOutfits(
      emptyCandidates({ bottoms: [miniSkirt], tops: [sleevelessTop], shoes: [shoes], outerwear: [woolCoat] }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(results).toEqual([]);
  });

  it('finds a valid outfit once trousers and a jumper are also available', () => {
    // Wool, not Denim: the higher floor at 6°C (WARMTH_UNITS_PER_DEGREE)
    // raises the leg-region target above what Denim's own clamped warmth can
    // reach on its own.
    const trousers = item('Pants', {
      inferredWarmth: estimateWarmth('Pants', ['Wool'], 'Short', 'Long'),
      inferredWind: estimateWind('Pants', ['Wool'], 'Short', 'Long'),
    });
    // Wool, not plain: same reasoning, for the torso-region target.
    const woolJumper = item('Sweater', {
      inferredWarmth: estimateWarmth('Sweater', ['Wool']),
      inferredWind: estimateWind('Sweater', ['Wool']),
    });

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [miniSkirt, trousers],
        tops: [sleevelessTop, woolJumper],
        shoes: [shoes],
        outerwear: [woolCoat],
      }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(results.length).toBeGreaterThan(0);
    for (const outfit of results) {
      expect(outfit.some((i) => i.id === miniSkirt.id)).toBe(false);
      expect(outfit.some((i) => i.id === sleevelessTop.id)).toBe(false);
    }
  });
});

describe('generateClosestOutfits: regression — the cold-weather ceiling has room for a coat over a full layering system at 5°C', () => {
  // Reported bug: jeans + wool sweater + long-sleeve T-shirt base layer +
  // leather boots + wool coat (24 summed, weighted warmth) sat 1 point above
  // a flat floor+5 ceiling of 23 at 5°C -- the exact outfit a coat was meant
  // to complete, given that jeans + sweater + T-shirt + boots alone (14)
  // falls short of the 18 floor, was itself rejected as overdressed. Both
  // this outfit and the same one with the T-shirt base layer dropped (22)
  // must be accepted -- see COLD_CEILING_BONUS_MAX in thermal.ts.
  it('accepts the reported outfit with and without its T-shirt base layer', () => {
    const feltTempC = 5;
    const windSpeedKph = 0;
    const floor = warmthFloor(feltTempC);
    const ceiling = warmthCeiling(feltTempC);
    const wFloor = windFloor(windSpeedKph, feltTempC);
    expect(floor).toBe(18);
    expect(ceiling).toBe(25);

    const jeans = item('Pants', {
      inferredWarmth: estimateWarmth('Pants', ['Denim'], 'Short', 'Long'),
      inferredWind: estimateWind('Pants', ['Denim'], 'Short', 'Long'),
    });
    const woolSweater = item('Sweater', {
      inferredWarmth: estimateWarmth('Sweater', ['Wool'], 'Long'),
      inferredWind: estimateWind('Sweater', ['Wool'], 'Long'),
    });
    const polyesterTshirt = item('T-Shirt', {
      inferredWarmth: estimateWarmth('T-Shirt', ['Polyester'], 'Long'),
      inferredWind: estimateWind('T-Shirt', ['Polyester'], 'Long'),
    });
    const leatherBoots = item('Boots', {
      inferredWarmth: estimateWarmth('Boots', ['Leather']),
      inferredWind: estimateWind('Boots', ['Leather']),
    });
    const woolCoat = item('Coat', {
      inferredWarmth: estimateWarmth('Coat', ['Wool'], 'Short', 'Long'),
      inferredWind: estimateWind('Coat', ['Wool'], 'Short', 'Long'),
    });

    const results = generateClosestOutfits(
      emptyCandidates({
        bottoms: [jeans],
        tops: [woolSweater, polyesterTshirt],
        shoes: [leatherBoots],
        outerwear: [woolCoat],
      }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
      100,
    );

    // Requiring the Sweater alongside the Coat in both branches is what
    // isolates "with vs. without the T-shirt base layer" -- without it, a
    // T-shirt-only (no Sweater) outfit would also match "has a T-shirt".
    const sweaterAndCoat = results.filter(
      (outfit) =>
        outfit.items.some((i) => i.id === woolSweater.id) && outfit.items.some((i) => i.id === woolCoat.id),
    );
    const withCoatAndTshirt = sweaterAndCoat.find((outfit) => outfit.items.some((i) => i.id === polyesterTshirt.id));
    const withCoatNoTshirt = sweaterAndCoat.find(
      (outfit) => !outfit.items.some((i) => i.id === polyesterTshirt.id),
    );

    expect(withCoatAndTshirt?.warmth).toBe(24);
    expect(withCoatAndTshirt?.meetsTarget).toBe(true);
    expect(withCoatNoTshirt?.warmth).toBe(22);
    expect(withCoatNoTshirt?.meetsTarget).toBe(true);
  });
});

describe('generateClosestOutfits: regression — a belt with no compatible bag must not outrank one with one', () => {
  // Reported bug: a Gold-hardware belt that had no matching bag kept beating
  // a Silver-hardware belt that did, for the same Top/Bottom pairing --
  // dismatching the Gold belt from its Gold bag just left every shown outfit
  // bagless, since selectDiverseOutfits (outfitDiversity.ts) treats outfits
  // that differ only by Belt as the same combo and keeps just the top-ranked
  // one. Belt and Bag both contribute 0 warmth (see outfitScoring.ts), so
  // without a tie-break on accessory count, the two belts tied on every
  // weather measure and whichever the search visited first (pool order) won
  // regardless of whether it could carry a bag at all.
  it('ranks the belt that can carry a compatible bag ahead of one that cannot', () => {
    const bottom = item('Pants', { hasBeltLoops: true });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    // Gold sorts first in pool order (accessoryFirst preserves insertion
    // order for untouched items), so without the fix this is the one that
    // would win the tie.
    const goldBelt = item('Belt', { hardwareColor: 'Gold' });
    const silverBelt = item('Belt', { hardwareColor: 'Silver' });
    const silverBag = item('Bag', { hardwareColor: 'Silver' });

    const results = generateClosestOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        belts: [goldBelt, silverBelt],
        bags: [silverBag],
      }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    // Belt is required, so every result has one -- the fix is about which
    // belt (and whether a bag comes with it) ranks first.
    const best = results[0];
    expect(best.items.some((i) => i.id === silverBelt.id)).toBe(true);
    expect(best.items.some((i) => i.id === silverBag.id)).toBe(true);
  });
});

describe('generateOutfits: regression — a lighter Outerwear option must not be excluded from the pool by heavier ones', () => {
  // Reported bug: a mild-cool day's warmth window (e.g. 14-20) found no
  // outfit at all even though the wardrobe had a light jacket that would
  // have bridged it -- the Outerwear slot used to rank candidates
  // heaviest-first and keep only the top MAX_ACCESSORY_CANDIDATES (3), so a
  // light jacket never entered the search once the closet held 3 warmer
  // coats, regardless of what any given day's ceiling could actually fit.
  it('finds an outfit using a light jacket when every heavier coat would overshoot the ceiling', () => {
    // inferredWarmth: 3 on the bottom -- not 0 -- so the leg-region floor
    // (meetsRegionFloors in outfitScoring.ts, unaffected by Outerwear) clears
    // regardless of what fills the Outerwear slot, and Outerwear choice is
    // the only thing this fixture's meetsTarget outcome actually depends on.
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('Sweater', { inferredWarmth: 5, inferredWind: 2 });
    const shoes = item('Boots', { inferredWarmth: 2, inferredWind: 3 });
    const lightJacket = item('Jacket', { inferredWarmth: 3, inferredWind: 3 });
    const heavyCoats = Array.from({ length: 3 }, () => item('Coat', { inferredWarmth: 9, inferredWind: 8 }));

    const bareWarmth = sumWarmth([top, bottom, shoes]);
    const withLightJacket = sumWarmth([top, bottom, shoes, lightJacket]);
    const withHeavyCoat = sumWarmth([top, bottom, shoes, heavyCoats[0]]);

    // A floor just above bare (rules out no-outerwear) and a ceiling just at
    // the light-jacket total but below the heavy-coat total (rules out
    // every heavy coat) -- only the light jacket can bridge the gap. If this
    // assertion ever fails, the fixture's numbers no longer isolate the bug
    // and need adjusting, not the assertions below it.
    const floor = Math.ceil(bareWarmth) + 1;
    const ceiling = Math.ceil(withLightJacket);
    expect(withHeavyCoat).toBeGreaterThan(ceiling);

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        outerwear: [...heavyCoats, lightJacket],
      }),
      noDismatches,
      floor,
      ceiling,
      0,
    );

    expect(results.some((outfit) => outfit.some((i) => i.id === lightJacket.id))).toBe(true);
  });

  // Reported bug (v2): fixing the above by splitting the existing
  // heaviest-3 pool between both ends (rather than adding the leanest
  // option on top of it) shrank heavy-coat coverage to just the single
  // highest-insulation item -- a wool coat that wasn't literally that one
  // item (edged out by, say, a windproof shell scoring higher on
  // warmth+wind combined despite being less warm on its own) dropped out of
  // the search at every cold temperature, not just the one being fixed.
  it('still finds every one of several heavier coats, not just the single warmest by combined insulation', () => {
    // inferredWarmth high enough on the bottom and top that the leg- and
    // torso-region floors (meetsRegionFloors) clear at this test's floor
    // regardless of which coat fills Outerwear -- outerwear doesn't count
    // toward either region floor, so only its effect on total warmth is
    // what this fixture's meetsTarget outcome depends on.
    const bottom = item('Pants', { inferredWarmth: 6, inferredWind: 2 });
    const top = item('Sweater', { inferredWarmth: 8, inferredWind: 2 });
    const shoes = item('Boots', { inferredWarmth: 2, inferredWind: 3 });
    const lightJacket = item('Jacket', { inferredWarmth: 2, inferredWind: 2 });
    // Highest combined insulation (15), but the least warmth of the three
    // heavier options -- exactly the item a naive "single warmest" pool
    // would keep instead of the wool coat.
    const windproofShell = item('Jacket', { inferredWarmth: 5, inferredWind: 10 });
    const woolCoat = item('Coat', { inferredWarmth: 10, inferredWind: 3 });
    const canvasCoat = item('Coat', { inferredWarmth: 6, inferredWind: 6 });

    const withShell = sumWarmth([top, bottom, shoes, windproofShell]);
    const withWoolCoat = sumWarmth([top, bottom, shoes, woolCoat]);
    // Sanity: only the wool coat's own warmth, not the shell's higher
    // combined insulation, can clear this floor.
    expect(withWoolCoat).toBeGreaterThan(withShell);
    const floor = Math.ceil(withShell) + 1;
    expect(floor).toBeLessThanOrEqual(withWoolCoat);

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        outerwear: [windproofShell, woolCoat, canvasCoat, lightJacket],
      }),
      noDismatches,
      floor,
      NO_CEILING,
      0,
    );

    expect(results.some((outfit) => outfit.some((i) => i.id === woolCoat.id))).toBe(true);
  });
});

describe('generateOutfits: regression — warm boots must not be excluded from the required Shoes slot by lighter ones', () => {
  // Reported bug: no outfit at all at several cold temperatures (down to and
  // below 0°C), even though the wardrobe had boots warm enough to close the
  // gap -- Shoes used plain leanFirst (lightest-only, capped at
  // MAX_SLOT_CANDIDATES), the same blind spot floorAwareCandidates already
  // fixed for Top and the Bottom/Dress anchor, but Shoes is a *required*
  // slot: excluding the only warm-enough boots from its pool doesn't just
  // drop an optional layer, it fails every branch of the search outright.
  it('finds an outfit using warm boots when six lighter pairs would otherwise fill the candidate pool', () => {
    const bottom = item('Pants', { inferredWarmth: 8, inferredWind: 4 });
    const top = item('Sweater', { inferredWarmth: 8, inferredWind: 2 });
    const lightShoes = Array.from({ length: 6 }, () => item('Boots', { inferredWarmth: 0, inferredWind: 0 }));
    const warmBoots = item('Boots', { inferredWarmth: 6, inferredWind: 5 });

    const withLightShoes = sumWarmth([top, bottom, lightShoes[0]]);
    const withWarmBoots = sumWarmth([top, bottom, warmBoots]);
    // A floor just above the light shoes' own total, that only the warm
    // boots can reach -- if this assertion ever fails, the fixture's
    // numbers no longer isolate the bug and need adjusting, not the
    // assertion below it.
    const floor = Math.ceil(withLightShoes) + 1;
    expect(withWarmBoots).toBeGreaterThanOrEqual(floor);

    const results = generateOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [...lightShoes, warmBoots] }),
      noDismatches,
      floor,
      NO_CEILING,
      0,
    );

    expect(results.some((outfit) => outfit.some((i) => i.id === warmBoots.id))).toBe(true);
  });
});
