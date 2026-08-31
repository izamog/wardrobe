import { recencyPenalty, scoreFor, compareByScore, rankWithFairTiebreak } from '../outfitCandidatePools';
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

  it('is deterministic: always returns 0 for exact ties', () => {
    const a = item({ id: 'a', inferredWarmth: 0, inferredWind: 0 });
    const b = item({ id: 'b', inferredWarmth: 0, inferredWind: 0 });
    for (let i = 0; i < 20; i++) {
      expect(compareByScore(a, b, new Map())).toBe(0);
    }
  });

  it('never returns a nonzero value for a genuine tie', () => {
    const a = item({ id: 'a', inferredWarmth: 0, inferredWind: 0 });
    const b = item({ id: 'b', inferredWarmth: 0, inferredWind: 0 });
    expect(compareByScore(a, b, new Map())).toBe(0);
  });
});

describe('rankWithFairTiebreak', () => {
  it('breaks an exact score tie randomly rather than by input order', () => {
    const a = item({ id: 'a', inferredWarmth: 0, inferredWind: 0 });
    const b = item({ id: 'b', inferredWarmth: 0, inferredWind: 0 });

    const seenOrders = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const ranked = rankWithFairTiebreak([a, b], new Map());
      seenOrders.add(ranked[0].id);
    }
    // Over 40 draws, a fair shuffle should produce both 'a' and 'b' at the
    // first position at least once; this would be flaky at 1 draw but not at 40
    // (p < 1e-11 for an unbiased shuffle to land the same way 40 times running).
    expect(seenOrders.has('a')).toBe(true);
    expect(seenOrders.has('b')).toBe(true);
  });

  it('never randomizes a real, non-tied difference', () => {
    const light = item({ id: 'a', inferredWarmth: 1, inferredWind: 0 });
    const heavy = item({ id: 'b', inferredWarmth: 5, inferredWind: 0 });
    for (let i = 0; i < 20; i++) {
      const ranked = rankWithFairTiebreak([heavy, light], new Map());
      expect(ranked[0].id).toBe('a'); // light always comes first
    }
  });

  it('preserves all items when shuffling tied runs with 3+ items', () => {
    const a = item({ id: 'a', inferredWarmth: 0, inferredWind: 0 });
    const b = item({ id: 'b', inferredWarmth: 0, inferredWind: 0 });
    const c = item({ id: 'c', inferredWarmth: 0, inferredWind: 0 });

    for (let i = 0; i < 20; i++) {
      const ranked = rankWithFairTiebreak([a, b, c], new Map());
      const ids = new Set(ranked.map((it) => it.id));
      expect(ids.has('a')).toBe(true);
      expect(ids.has('b')).toBe(true);
      expect(ids.has('c')).toBe(true);
      expect(ranked.length).toBe(3);
    }
  });
});
