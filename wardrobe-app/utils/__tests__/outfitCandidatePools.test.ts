import {
  recencyPenalty,
  scoreFor,
  compareByScore,
  rankWithFairTiebreak,
  leanFirst,
  layerFirst,
  accessoryFirst,
  floorAwareCandidates,
  floorAwareOuterwearCandidates,
} from '../outfitCandidatePools';
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
    isWorkAppropriate: false,
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

describe('leanFirst with wornDaysAgo', () => {
  it('still sorts lightest-first when nothing was recently worn', () => {
    const light = item({ id: 'a', inferredWarmth: 1 });
    const heavy = item({ id: 'b', inferredWarmth: 5 });
    expect(leanFirst([heavy, light]).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('a recently-worn item sorts behind an equally-warm alternative', () => {
    const wornRecently = item({ id: 'a', inferredWarmth: 3 });
    const notWorn = item({ id: 'b', inferredWarmth: 3 });
    const wornDaysAgo = new Map([['a', 1]]);
    expect(leanFirst([wornRecently, notWorn], wornDaysAgo).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('recency never overrides a real warmth difference', () => {
    const lightButRecent = item({ id: 'a', inferredWarmth: 1 });
    const heavyNotWorn = item({ id: 'b', inferredWarmth: 8 });
    const wornDaysAgo = new Map([['a', 0]]);
    expect(leanFirst([heavyNotWorn, lightButRecent], wornDaysAgo).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('accessoryFirst with wornDaysAgo: the confirmed gold-vs-silver case', () => {
  it('a less-recently-worn zero-insulation accessory sorts ahead of a more-recently-worn one', () => {
    const goldBelt = item({ id: 'gold', category: 'Belt', hardwareColor: 'Gold' });
    const silverBelt = item({ id: 'silver', category: 'Belt', hardwareColor: 'Silver' });
    const wornDaysAgo = new Map([['gold', 1]]);
    expect(accessoryFirst([goldBelt, silverBelt], wornDaysAgo).map((i) => i.id)).toEqual(['silver', 'gold']);
  });

  it('with no wear history for either, both orderings occur across repeated calls', () => {
    const goldBelt = item({ id: 'gold', category: 'Belt', hardwareColor: 'Gold' });
    const silverBelt = item({ id: 'silver', category: 'Belt', hardwareColor: 'Silver' });

    const firstIds = new Set<string>();
    for (let i = 0; i < 40; i++) {
      firstIds.add(accessoryFirst([goldBelt, silverBelt])[0].id);
    }
    expect(firstIds.has('gold')).toBe(true);
    expect(firstIds.has('silver')).toBe(true);
  });
});

describe('layerFirst (descending) with wornDaysAgo', () => {
  it('a real insulation difference is never overridden by recency, in descending order too', () => {
    const heavierWorn = item({ id: 'a', category: 'Coat', inferredWarmth: 8, inferredWind: 0 });
    const lighterUnworn = item({ id: 'b', category: 'Coat', inferredWarmth: 2, inferredWind: 0 });
    const wornDaysAgo = new Map([['a', 0]]);
    expect(layerFirst([lighterUnworn, heavierWorn], wornDaysAgo).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('among equal-insulation coats, the recently-worn one sorts after the unworn one', () => {
    const wornCoat = item({ id: 'worn', category: 'Coat', inferredWarmth: 8, inferredWind: 0 });
    const unwornCoat = item({ id: 'unworn', category: 'Coat', inferredWarmth: 8, inferredWind: 0 });
    const wornDaysAgo = new Map([['worn', 0]]);
    expect(layerFirst([wornCoat, unwornCoat], wornDaysAgo).map((i) => i.id)).toEqual(['unworn', 'worn']);
  });
});

describe('floorAwareOuterwearCandidates with wornDaysAgo', () => {
  it('a recently-worn coat still enters the pool (recency nudges rank, not membership)', () => {
    const wornCoat = item({ id: 'worn', category: 'Coat', inferredWarmth: 8, inferredWind: 8 });
    const wornDaysAgo = new Map([['worn', 0]]);
    const ids = floorAwareOuterwearCandidates([wornCoat], wornDaysAgo).map((i) => i.id);
    expect(ids).toContain('worn');
  });

  it('among the heaviest-first half, a recently-worn coat still sorts after an equally-warm unworn one', () => {
    const wornCoat = item({ id: 'worn', category: 'Coat', inferredWarmth: 8, inferredWind: 0 });
    const unwornCoat = item({ id: 'unworn', category: 'Coat', inferredWarmth: 8, inferredWind: 0 });
    const wornDaysAgo = new Map([['worn', 0]]);
    const ids = floorAwareOuterwearCandidates([wornCoat, unwornCoat], wornDaysAgo).map((i) => i.id);
    expect(ids.indexOf('unworn')).toBeLessThan(ids.indexOf('worn'));
  });
});

describe('floorAwareCandidates with wornDaysAgo', () => {
  it('passes wornDaysAgo through to its internal leanFirst call', () => {
    const wornRecently = item({ id: 'a', category: 'Pants', inferredWarmth: 3 });
    const notWorn = item({ id: 'b', category: 'Pants', inferredWarmth: 3 });
    const wornDaysAgo = new Map([['a', 1]]);
    // warmthFloor 0 -> floorAwareCandidates is exactly leanFirst (see its own doc comment)
    expect(floorAwareCandidates([wornRecently, notWorn], 0, wornDaysAgo).map((i) => i.id)).toEqual(['b', 'a']);
  });
});
