/** @jest-environment node */
import { generateClosestOutfits, type OutfitCandidates, type ScoredOutfit } from '../outfitGenerator';
import { warmthCeiling, warmthFloor, windFloor } from '../thermal';
import { estimateWarmth, estimateWind } from '../warmth';
import { emptyCandidates, item, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';
import type { ClothingItem } from '../../types/wardrobe';

/**
 * Acceptance tests for what a weather-appropriate outfit actually looks like
 * for a real, diverse wardrobe across a full range of felt temperatures --
 * not just the individual bugs reported so far (see the regression describe
 * blocks in outfitGenerator.test.ts), but the general shape of "would a
 * person actually wear this at this temperature."
 *
 * One shared wardrobe, built fresh per test (buildWardrobe), spans a full
 * range of warmth per slot -- a couple of top weights, a light and a heavy
 * jacket alongside a coat, skirts from mini to maxi, shorts and jeans, every
 * shoe type -- deliberately more than a single-purpose regression fixture,
 * so the search has a genuine choice to make at every temperature rather
 * than only one candidate per slot. Every band below was confirmed via the
 * real generateClosestOutfits output (not just theorized) to have a
 * meetsTarget: true rank-0 recommendation this wardrobe can build.
 */

interface Wardrobe {
  candidates: OutfitCandidates;
  tankTop: ClothingItem;
  tshirt: ClothingItem;
  shirt: ClothingItem;
  woolShirt: ClothingItem;
  cardiganWool: ClothingItem;
  sweaterWool: ClothingItem;
  denimJacketShort: ClothingItem;
  denimJacketLong: ClothingItem;
  woolCoat: ClothingItem;
  denimShorts: ClothingItem;
  jeans: ClothingItem;
  woolTrousers: ClothingItem;
  miniSkirt: ClothingItem;
  midiSkirt: ClothingItem;
  maxiSkirt: ClothingItem;
  sundress: ClothingItem;
  sandals: ClothingItem;
  sneakers: ClothingItem;
  boots: ClothingItem;
  woolScarf: ClothingItem;
  tights: ClothingItem;
  bag: ClothingItem;
}

function buildWardrobe(): Wardrobe {
  const tankTop = item('Top', {
    sleeveLength: 'Sleeveless',
    inferredWarmth: estimateWarmth('Top', [], 'Sleeveless'),
    inferredWind: estimateWind('Top', [], 'Sleeveless'),
  });
  const tshirt = item('T-Shirt', {
    inferredWarmth: estimateWarmth('T-Shirt', []),
    inferredWind: estimateWind('T-Shirt', []),
  });
  const shirt = item('Shirt', { inferredWarmth: estimateWarmth('Shirt', []), inferredWind: estimateWind('Shirt', []) });
  const woolShirt = item('Shirt', {
    inferredWarmth: estimateWarmth('Shirt', ['Wool']),
    inferredWind: estimateWind('Shirt', ['Wool']),
  });
  const cardiganWool = item('Cardigan', {
    inferredWarmth: estimateWarmth('Cardigan', ['Wool'], 'Long'),
    inferredWind: estimateWind('Cardigan', ['Wool'], 'Long'),
  });
  const sweaterWool = item('Sweater', {
    inferredWarmth: estimateWarmth('Sweater', ['Wool'], 'Long'),
    inferredWind: estimateWind('Sweater', ['Wool'], 'Long'),
  });

  const denimJacketShort = item('Jacket', {
    inferredWarmth: estimateWarmth('Jacket', ['Denim'], 'Short'),
    inferredWind: estimateWind('Jacket', ['Denim'], 'Short'),
  });
  const denimJacketLong = item('Jacket', {
    inferredWarmth: estimateWarmth('Jacket', ['Denim'], 'Long'),
    inferredWind: estimateWind('Jacket', ['Denim'], 'Long'),
  });
  const woolCoat = item('Coat', {
    inferredWarmth: estimateWarmth('Coat', ['Wool'], 'Long'),
    inferredWind: estimateWind('Coat', ['Wool'], 'Long'),
  });

  const denimShorts = item('Pants', {
    length: 'Short',
    inferredWarmth: estimateWarmth('Pants', ['Denim'], 'Short', 'Short'),
    inferredWind: estimateWind('Pants', ['Denim'], 'Short', 'Short'),
  });
  const jeans = item('Pants', {
    length: 'Long',
    inferredWarmth: estimateWarmth('Pants', ['Denim'], 'Short', 'Long'),
    inferredWind: estimateWind('Pants', ['Denim'], 'Short', 'Long'),
  });
  // Genuine winter trousers, not just jeans: the region floors below now
  // demand more leg warmth than denim alone provides at real winter
  // temperatures -- a realistic closet has something warmer than jeans for
  // actual cold, the same way it has a coat rather than only a jacket.
  const woolTrousers = item('Pants', {
    length: 'Long',
    inferredWarmth: estimateWarmth('Pants', ['Wool'], 'Short', 'Long'),
    inferredWind: estimateWind('Pants', ['Wool'], 'Short', 'Long'),
  });
  const miniSkirt = item('Skirt', {
    length: 'Mini',
    inferredWarmth: estimateWarmth('Skirt', [], 'Short', 'Mini'),
    inferredWind: estimateWind('Skirt', [], 'Short', 'Mini'),
  });
  const midiSkirt = item('Skirt', {
    length: 'Midi',
    inferredWarmth: estimateWarmth('Skirt', [], 'Short', 'Midi'),
    inferredWind: estimateWind('Skirt', [], 'Short', 'Midi'),
  });
  const maxiSkirt = item('Skirt', {
    length: 'Maxi',
    inferredWarmth: estimateWarmth('Skirt', ['Wool'], 'Short', 'Maxi'),
    inferredWind: estimateWind('Skirt', ['Wool'], 'Short', 'Maxi'),
  });
  const sundress = item('Dress', {
    sleeveLength: 'Sleeveless',
    inferredWarmth: estimateWarmth('Dress', [], 'Sleeveless'),
    inferredWind: estimateWind('Dress', [], 'Sleeveless'),
  });

  const sandals = item('Sandals', {
    inferredWarmth: estimateWarmth('Sandals', []),
    inferredWind: estimateWind('Sandals', []),
  });
  const sneakers = item('Shoes', { inferredWarmth: estimateWarmth('Shoes', []), inferredWind: estimateWind('Shoes', []) });
  const boots = item('Boots', { inferredWarmth: estimateWarmth('Boots', []), inferredWind: estimateWind('Boots', []) });

  const woolScarf = item('Scarf', {
    inferredWarmth: estimateWarmth('Scarf', ['Wool']),
    inferredWind: estimateWind('Scarf', ['Wool']),
  });
  // Wool, not plain: at real winter floors, a Skirt/Dress anchor needs
  // Tights to add real leg warmth on top of it (see legWarmth in
  // outfitScoring.ts) -- a Skirt's own clamped max (6) falls short of the
  // leg-region target on the coldest bands below on its own, the same way a
  // realistic closet has something warmer than a bare pair of tights for
  // actual cold.
  const tights = item('Tights', {
    inferredWarmth: estimateWarmth('Tights', ['Wool']),
    inferredWind: estimateWind('Tights', ['Wool']),
  });
  const bag = item('Bag', {});

  return {
    candidates: emptyCandidates({
      bottoms: [denimShorts, jeans, woolTrousers, miniSkirt, midiSkirt, maxiSkirt, sundress],
      tops: [tankTop, tshirt, shirt, woolShirt, cardiganWool, sweaterWool],
      shoes: [sandals, sneakers, boots],
      outerwear: [denimJacketShort, denimJacketLong, woolCoat],
      scarves: [woolScarf],
      bags: [bag],
      tights: [tights],
    }),
    tankTop,
    tshirt,
    shirt,
    woolShirt,
    cardiganWool,
    sweaterWool,
    denimJacketShort,
    denimJacketLong,
    woolCoat,
    denimShorts,
    jeans,
    woolTrousers,
    miniSkirt,
    midiSkirt,
    maxiSkirt,
    sundress,
    sandals,
    sneakers,
    boots,
    woolScarf,
    tights,
    bag,
  };
}

/** windSpeedKph fixed at a light, everyday breeze — these tests are about the temperature axis, not wind (see the dedicated gale-force regressions in outfitGenerator.test.ts). */
const WIND_SPEED_KPH = 10;

function recommend(wardrobe: Wardrobe, feltTempC: number): ScoredOutfit[] {
  const floor = warmthFloor(feltTempC);
  const ceiling = warmthCeiling(feltTempC);
  const wFloor = windFloor(WIND_SPEED_KPH, feltTempC);
  return generateClosestOutfits(wardrobe.candidates, noDismatches, floor, ceiling, wFloor, 3);
}

function hasId(outfit: ScoredOutfit, target: ClothingItem): boolean {
  return outfit.items.some((i) => i.id === target.id);
}

beforeEach(() => {
  resetSeq();
});

describe('generateClosestOutfits: appropriateness across temperature bands', () => {
  it('at 0°C (freezing), recommends a real outfit and never a mini skirt, shorts, sandals or an unlayered sleeveless top', () => {
    const wardrobe = buildWardrobe();
    const results = recommend(wardrobe, 0);
    const best = results[0];

    expect(best.meetsTarget).toBe(true);
    expect(hasId(best, wardrobe.miniSkirt)).toBe(false);
    expect(hasId(best, wardrobe.denimShorts)).toBe(false);
    expect(hasId(best, wardrobe.sandals)).toBe(false);
    expect(hasId(best, wardrobe.sundress)).toBe(false);
    // A sleeveless tank is fine at freezing *when* it's a base layer under a
    // real mid-layer (Cardigan or Sweater) — that combination is what
    // actually clears the torso floor here (see meetsTorsoFloor in
    // outfitScoring.ts and clearsCardiganLayerRule in pairs.ts, which is what
    // now guarantees a Cardigan never appears without one). A bare tank with
    // no such layer never could, on its own warmth, so this only rules out
    // the case that would actually be underdressed.
    if (hasId(best, wardrobe.tankTop)) {
      expect(hasId(best, wardrobe.cardiganWool) || hasId(best, wardrobe.sweaterWool)).toBe(true);
    }
    // A real outer layer belongs somewhere among the top picks at freezing —
    // checked across all of them, not just rank 0: jeans layered under a
    // wool shirt and scarf is itself warm enough to meet target without a
    // jacket (13 warmth against a 12-18 band), so it can legitimately tie
    // for the top spot alongside a jacketed alternative. Both are real,
    // weather-appropriate outfits; this only guards against a jacket/coat
    // never being offered at all.
    const anyHasOuterLayer = results.some(
      (r) => hasId(r, wardrobe.denimJacketShort) || hasId(r, wardrobe.denimJacketLong) || hasId(r, wardrobe.woolCoat),
    );
    expect(anyHasOuterLayer).toBe(true);
  });

  it('at 5°C (cold), recommends a real outfit and never shorts, sandals or a sleeveless top', () => {
    const wardrobe = buildWardrobe();
    const results = recommend(wardrobe, 5);
    const best = results[0];

    expect(best.meetsTarget).toBe(true);
    expect(hasId(best, wardrobe.denimShorts)).toBe(false);
    expect(hasId(best, wardrobe.sandals)).toBe(false);
    expect(hasId(best, wardrobe.tankTop)).toBe(false);
  });

  it('at 10°C (cool), recommends a real outfit and never shorts or sandals', () => {
    const wardrobe = buildWardrobe();
    const results = recommend(wardrobe, 10);
    const best = results[0];

    expect(best.meetsTarget).toBe(true);
    expect(hasId(best, wardrobe.denimShorts)).toBe(false);
    expect(hasId(best, wardrobe.sandals)).toBe(false);
  });

  it('at 15°C (mild), recommends a real outfit and never a heavy wool coat', () => {
    const wardrobe = buildWardrobe();
    const results = recommend(wardrobe, 15);
    const best = results[0];

    expect(best.meetsTarget).toBe(true);
    // Ceiling at 15°C (warmthCeiling(15) = 9) is well below a wool coat's own
    // weighted contribution (10), so it should never survive the search.
    expect(hasId(best, wardrobe.woolCoat)).toBe(false);
  });

  it('at 20°C (warm), recommends a real outfit and never a coat, jacket or wool jumper', () => {
    const wardrobe = buildWardrobe();
    const results = recommend(wardrobe, 20);
    const best = results[0];

    expect(best.meetsTarget).toBe(true);
    expect(hasId(best, wardrobe.woolCoat)).toBe(false);
    expect(hasId(best, wardrobe.denimJacketLong)).toBe(false);
    expect(hasId(best, wardrobe.denimJacketShort)).toBe(false);
    expect(hasId(best, wardrobe.sweaterWool)).toBe(false);
    expect(hasId(best, wardrobe.cardiganWool)).toBe(false);
  });

  it('at 25°C (hot), recommends a real outfit and never jeans, a coat, a jacket or a wool jumper', () => {
    const wardrobe = buildWardrobe();
    const results = recommend(wardrobe, 25);
    const best = results[0];

    expect(best.meetsTarget).toBe(true);
    expect(hasId(best, wardrobe.jeans)).toBe(false);
    expect(hasId(best, wardrobe.woolCoat)).toBe(false);
    expect(hasId(best, wardrobe.denimJacketLong)).toBe(false);
    expect(hasId(best, wardrobe.denimJacketShort)).toBe(false);
    expect(hasId(best, wardrobe.sweaterWool)).toBe(false);
    expect(hasId(best, wardrobe.cardiganWool)).toBe(false);
    expect(hasId(best, wardrobe.boots)).toBe(false);
  });

  it('at 30°C (very hot), recommends a real outfit and never jeans, a coat, a jacket, boots or a wool jumper', () => {
    const wardrobe = buildWardrobe();
    const results = recommend(wardrobe, 30);
    const best = results[0];

    expect(best.meetsTarget).toBe(true);
    expect(hasId(best, wardrobe.jeans)).toBe(false);
    expect(hasId(best, wardrobe.woolCoat)).toBe(false);
    expect(hasId(best, wardrobe.denimJacketLong)).toBe(false);
    expect(hasId(best, wardrobe.denimJacketShort)).toBe(false);
    expect(hasId(best, wardrobe.sweaterWool)).toBe(false);
    expect(hasId(best, wardrobe.woolShirt)).toBe(false);
    expect(hasId(best, wardrobe.boots)).toBe(false);
  });

  it('never recommends sandals at any felt temperature that calls for extra warmth', () => {
    // A blanket sweep, not just the extremes above -- shoeCandidatesFor
    // excludes Sandals from the pool entirely once warmthFloor > 0, so this
    // should hold at every band with a nonzero floor, not just 0°C.
    const wardrobe = buildWardrobe();
    for (const feltTempC of [0, 5, 10, 15]) {
      const [best] = recommend(wardrobe, feltTempC);
      expect(hasId(best, wardrobe.sandals)).toBe(false);
    }
  });

  it('never recommends a wool coat once the ceiling can no longer fit its own weighted warmth', () => {
    // A blanket sweep across the warm end -- warmthCeiling(feltTempC) sits at
    // its floor of 6 from 20°C up, well under the coat's own weighted
    // contribution of 10, so it should never appear in any meetsTarget result
    // at or above 20°C, not just the single 20°C/25°C/30°C spot checks above.
    const wardrobe = buildWardrobe();
    for (const feltTempC of [20, 25, 30]) {
      const results = recommend(wardrobe, feltTempC);
      for (const outfit of results.filter((r) => r.meetsTarget)) {
        expect(hasId(outfit, wardrobe.woolCoat)).toBe(false);
      }
    }
  });

  it('recommends progressively warmer outfits as felt temperature drops', () => {
    // Sanity check on the shape of the whole curve, not just the endpoints:
    // the best-match outfit's own computed warmth should trend upward as it
    // gets colder, not bounce around unpredictably.
    const wardrobe = buildWardrobe();
    const warmthByTemp = [30, 20, 10, 0].map((feltTempC) => recommend(wardrobe, feltTempC)[0].warmth);

    for (let i = 1; i < warmthByTemp.length; i += 1) {
      expect(warmthByTemp[i]).toBeGreaterThanOrEqual(warmthByTemp[i - 1]);
    }
  });
});
