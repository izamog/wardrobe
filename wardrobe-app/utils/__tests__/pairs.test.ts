/** @jest-environment node */
import { buildUnratedPairs, isCompatibleCandidate, pairKey } from '../pairs';
import type { Category, ClothingItem, HardwareColor } from '../../types/wardrobe';

const item = (
  id: string,
  category: Category,
  overrides: Partial<Pick<ClothingItem, 'hasBeltLoops' | 'hardwareColor'>> = {},
): ClothingItem => ({
  id,
  imagePath: '',
  originalImagePath: '',
  primaryColor: '',
  secondaryColor: '',
  category,
  brand: id,
  costMinorUnits: 0,
  isSecondHand: false,
  materials: [],
  hardwareColor: 'None',
  hasBeltLoops: false,
  sleeveLength: 'Short',
  length: '',
  inferredWarmth: 0,
  inferredWind: 0,
  wearCount: 0,
  createdAt: 'now',
  ...overrides,
});

describe('buildUnratedPairs', () => {
  it('pairs complementary categories', () => {
    const pairs = buildUnratedPairs([item('a', 'Top'), item('b', 'Pants')], new Set());
    expect(pairs.map((p) => p.key)).toEqual(['a|b']);
  });

  it('never pairs an item with another in the same category', () => {
    expect(buildUnratedPairs([item('a', 'Top'), item('b', 'Top')], new Set())).toEqual([]);
  });

  it('never pairs two accessories with each other', () => {
    // getComplementaryCategories excludes Bag/Scarf from each other.
    expect(buildUnratedPairs([item('a', 'Bag'), item('b', 'Scarf')], new Set())).toEqual([]);
  });

  it('pairs two tops when one can be layered over the other', () => {
    // Same group, so the plain same-category rule would exclude them; the
    // layering rules are what put this pair back in the deck.
    const pairs = buildUnratedPairs([item('a', 'T-Shirt'), item('b', 'Sweater')], new Set());
    expect(pairs.map((p) => p.key)).toEqual(['a|b']);
  });

  it('does not pair two tops that cannot be layered together', () => {
    expect(buildUnratedPairs([item('a', 'T-Shirt'), item('b', 'Top')], new Set())).toEqual([]);
    expect(buildUnratedPairs([item('a', 'Cardigan'), item('b', 'Sweater')], new Set())).toEqual([]);
  });

  it('does not pair a jacket with a coat', () => {
    expect(buildUnratedPairs([item('a', 'Jacket'), item('b', 'Coat')], new Set())).toEqual([]);
  });

  it('pairs a top with outerwear, which are different slots', () => {
    const pairs = buildUnratedPairs([item('a', 'Sweater'), item('b', 'Jacket')], new Set());
    expect(pairs.map((p) => p.key)).toEqual(['a|b']);
  });

  it('offers each unordered pair once', () => {
    const pairs = buildUnratedPairs(
      [item('a', 'Top'), item('b', 'Pants'), item('c', 'Shoes')],
      new Set(),
    );
    expect(pairs.map((p) => p.key).sort()).toEqual(['a|b', 'a|c', 'b|c']);
  });

  it('skips pairs that already have a verdict, so the deck empties', () => {
    const items = [item('a', 'Top'), item('b', 'Pants')];
    expect(buildUnratedPairs(items, new Set(['a|b']))).toEqual([]);
  });

  it('matches the stored key regardless of the order the pair was seen in', () => {
    // Items arrive newest-first, so the higher id can come first.
    const pairs = buildUnratedPairs([item('z', 'Top'), item('a', 'Pants')], new Set());
    expect(pairs[0].key).toBe('a|z');
    expect(buildUnratedPairs([item('z', 'Top'), item('a', 'Pants')], new Set(['a|z']))).toEqual([]);
  });
});

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
  });
});

describe('isCompatibleCandidate', () => {
  const belt = (hw: HardwareColor) => item('belt', 'Belt', { hardwareColor: hw });
  const bag = (hw: HardwareColor) => item('bag', 'Bag', { hardwareColor: hw });
  const bottom = (hasBeltLoops: boolean) => item('bottom', 'Pants', { hasBeltLoops });

  it('rejects a belt against a bottom with no belt loops', () => {
    expect(isCompatibleCandidate(bottom(false), belt('None'))).toBe(false);
    expect(isCompatibleCandidate(belt('None'), bottom(false))).toBe(false);
  });

  it('allows a belt against a bottom that has belt loops', () => {
    expect(isCompatibleCandidate(bottom(true), belt('None'))).toBe(true);
  });

  it('does not apply the belt-loop rule to non-belt, non-bottom pairs', () => {
    expect(isCompatibleCandidate(bottom(false), item('shoes', 'Shoes'))).toBe(true);
  });

  it('rejects a belt and bag with clashing hardware finishes', () => {
    expect(isCompatibleCandidate(belt('Gold'), bag('Silver'))).toBe(false);
  });

  it('allows a belt and bag whose hardware finishes read as the same family', () => {
    expect(isCompatibleCandidate(belt('Gold'), bag('Brass'))).toBe(true);
    expect(isCompatibleCandidate(belt('Silver'), bag('Black'))).toBe(true);
  });

  it('ignores hardware finish once either side has none', () => {
    expect(isCompatibleCandidate(belt('None'), bag('Silver'))).toBe(true);
  });

  it('does not apply the hardware rule outside Belt/Bag pairs', () => {
    // hardwareColor is only meaningful on Belt and Bag; a Top's default 'None'
    // must never be read as a clash against a belt's actual finish.
    expect(isCompatibleCandidate(belt('Gold'), item('top', 'Top'))).toBe(true);
  });
});

describe('buildUnratedPairs: belt loops and hardware finish', () => {
  it('excludes a belt from a bottom with no belt loops', () => {
    const pairs = buildUnratedPairs([item('a', 'Pants', { hasBeltLoops: false }), item('b', 'Belt')], new Set());
    expect(pairs).toEqual([]);
  });

  it('offers a belt against a bottom that has belt loops', () => {
    const pairs = buildUnratedPairs([item('a', 'Pants', { hasBeltLoops: true }), item('b', 'Belt')], new Set());
    expect(pairs.map((p) => p.key)).toEqual(['a|b']);
  });

  it('excludes a belt and bag with clashing hardware finishes', () => {
    const pairs = buildUnratedPairs(
      [item('a', 'Belt', { hardwareColor: 'Gold' }), item('b', 'Bag', { hardwareColor: 'Silver' })],
      new Set(),
    );
    expect(pairs).toEqual([]);
  });
});
