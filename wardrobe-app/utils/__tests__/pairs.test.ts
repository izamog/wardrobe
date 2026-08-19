/** @jest-environment node */
import { buildUnratedPairs, pairKey } from '../pairs';
import type { Category, ClothingItem } from '../../types/wardrobe';

const item = (id: string, category: Category): ClothingItem => ({
  id,
  imageUri: '',
  category,
  brand: id,
  costMinorUnits: 0,
  isSecondHand: false,
  materials: [],
  hardwareColor: 'None',
  hasBeltLoops: false,
  inferredWarmth: 0,
  inferredWind: 0,
  wearCount: 0,
  createdAt: 'now',
});

describe('buildUnratedPairs', () => {
  it('pairs complementary categories', () => {
    const pairs = buildUnratedPairs([item('a', 'Top'), item('b', 'Bottom')], new Set());
    expect(pairs.map((p) => p.key)).toEqual(['a|b']);
  });

  it('never pairs an item with another in the same category', () => {
    expect(buildUnratedPairs([item('a', 'Top'), item('b', 'Top')], new Set())).toEqual([]);
  });

  it('never pairs two accessories with each other', () => {
    // getComplementaryCategories excludes Bag/Scarf from each other.
    expect(buildUnratedPairs([item('a', 'Bag'), item('b', 'Scarf')], new Set())).toEqual([]);
  });

  it('offers each unordered pair once', () => {
    const pairs = buildUnratedPairs(
      [item('a', 'Top'), item('b', 'Bottom'), item('c', 'Shoes')],
      new Set(),
    );
    expect(pairs.map((p) => p.key).sort()).toEqual(['a|b', 'a|c', 'b|c']);
  });

  it('skips pairs that already have a verdict, so the deck empties', () => {
    const items = [item('a', 'Top'), item('b', 'Bottom')];
    expect(buildUnratedPairs(items, new Set(['a|b']))).toEqual([]);
  });

  it('matches the stored key regardless of the order the pair was seen in', () => {
    // Items arrive newest-first, so the higher id can come first.
    const pairs = buildUnratedPairs([item('z', 'Top'), item('a', 'Bottom')], new Set());
    expect(pairs[0].key).toBe('a|z');
    expect(buildUnratedPairs([item('z', 'Top'), item('a', 'Bottom')], new Set(['a|z']))).toEqual([]);
  });
});

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
  });
});
