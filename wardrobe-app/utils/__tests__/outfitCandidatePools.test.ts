import { recencyPenalty, scoreFor, compareByScore } from '../outfitCandidatePools';
import type { ClothingItem } from '../../types/wardrobe';

function item(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id: 'item-1',
    imagePath: '',
    originalImagePath: '',
    imageMarginBaked: false,
    category: 'Belt',
    brand: '',
    costMinorUnits: 0,
    isSecondHand: false,
    purchasedAt: '',
    materials: [],
    primaryColor: '',
    secondaryColor: '',
    hardwareColor: 'None',
    hasBeltLoops: false,
    sleeveLength: 'Short',
    length: '',
    thickness: 'Regular',
    denier: 0,
    backless: false,
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: '',
    archivedAt: '',
    ...overrides,
  };
}

describe('recencyPenalty', () => {
  it('is 0 for an item absent from the map (never worn, or outside the window)', () => {
    expect(recencyPenalty(item({ id: 'a' }), new Map())).toBe(0);
  });

  it('is strongest for worn within the last 7 days', () => {
    const worn0 = recencyPenalty(item({ id: 'a' }), new Map([['a', 0]]));
    const worn6 = recencyPenalty(item({ id: 'a' }), new Map([['a', 6]]));
    const worn10 = recencyPenalty(item({ id: 'a' }), new Map([['a', 10]]));
    expect(worn0).toBeGreaterThan(worn10);
    expect(worn6).toBeGreaterThan(worn10);
  });

  it('graduates down across the 7/14/30-day bands', () => {
    const band0to6 = recencyPenalty(item({ id: 'a' }), new Map([['a', 3]]));
    const band7to13 = recencyPenalty(item({ id: 'a' }), new Map([['a', 10]]));
    const band14to29 = recencyPenalty(item({ id: 'a' }), new Map([['a', 20]]));
    expect(band0to6).toBeGreaterThan(band7to13);
    expect(band7to13).toBeGreaterThan(band14to29);
    expect(band14to29).toBeGreaterThan(0);
  });

  it('is 0 at 30 days or more', () => {
    expect(recencyPenalty(item({ id: 'a' }), new Map([['a', 30]]))).toBe(0);
    expect(recencyPenalty(item({ id: 'a' }), new Map([['a', 90]]))).toBe(0);
  });
});

describe('scoreFor', () => {
  it('adds insulation and recencyPenalty', () => {
    const warmItem = item({ id: 'a', inferredWarmth: 5, inferredWind: 2 });
    const wornDaysAgo = new Map([['a', 1]]);
    expect(scoreFor(warmItem, wornDaysAgo)).toBe(7 + recencyPenalty(warmItem, wornDaysAgo));
  });
});

describe('compareByScore', () => {
  it('orders lower score first, same direction insulation-only sort used', () => {
    const light = item({ id: 'a', inferredWarmth: 1, inferredWind: 0 });
    const heavy = item({ id: 'b', inferredWarmth: 5, inferredWind: 0 });
    expect(compareByScore(light, heavy, new Map())).toBeLessThan(0);
    expect(compareByScore(heavy, light, new Map())).toBeGreaterThan(0);
  });

  it('breaks an exact score tie randomly rather than by input order', () => {
    const a = item({ id: 'a', inferredWarmth: 0, inferredWind: 0 });
    const b = item({ id: 'b', inferredWarmth: 0, inferredWind: 0 });

    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      seen.add(Math.sign(compareByScore(a, b, new Map())));
    }
    // Over 40 draws, a coin-flip tie-break should produce both -1 and 1 at
    // least once; this would be flaky at 1 draw but not at 40 (p < 1e-11 for
    // an unbiased coin to land the same way 40 times running).
    expect(seen.has(-1)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });

  it('never randomizes a real, non-tied difference', () => {
    const light = item({ id: 'a', inferredWarmth: 1, inferredWind: 0 });
    const heavy = item({ id: 'b', inferredWarmth: 5, inferredWind: 0 });
    for (let i = 0; i < 20; i++) {
      expect(compareByScore(light, heavy, new Map())).toBeLessThan(0);
    }
  });
});
