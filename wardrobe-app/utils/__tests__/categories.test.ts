/** @jest-environment node */
import {
  ALL_CATEGORIES,
  beltLoopsApply,
  CATEGORY_GROUP,
  getComplementaryCategories,
  hardwareColorApplies,
} from '../categories';
import { canLayerEitherWay } from '../layering';
import type { Category } from '../../types/wardrobe';

describe('getComplementaryCategories', () => {
  it('never returns the source category itself', () => {
    for (const category of ALL_CATEGORIES) {
      expect(getComplementaryCategories(category)).not.toContain(category);
    }
  });

  it('is symmetric, which Item_Compatibility relies on to store each pair once', () => {
    for (const a of ALL_CATEGORIES) {
      for (const b of ALL_CATEGORIES) {
        if (a === b) continue;
        expect(getComplementaryCategories(a).includes(b)).toBe(
          getComplementaryCategories(b).includes(a),
        );
      }
    }
  });

  it('does not pair the two accessory categories with each other', () => {
    expect(getComplementaryCategories('Bag')).not.toContain('Scarf');
    expect(getComplementaryCategories('Scarf')).not.toContain('Bag');
  });

  it('offers every garment category to an accessory', () => {
    const garments = ALL_CATEGORIES.filter(
      (c) => CATEGORY_GROUP[c] !== 'Bag' && CATEGORY_GROUP[c] !== 'Scarf',
    );
    expect(getComplementaryCategories('Bag')).toEqual(garments);
    expect(getComplementaryCategories('Scarf')).toEqual(garments);
  });

  it('excludes same-group categories that cannot be layered together', () => {
    // Two tops compete for one slot unless they can be worn at once.
    expect(getComplementaryCategories('T-Shirt')).not.toContain('Top');
    expect(getComplementaryCategories('Jacket')).not.toContain('Coat');
    expect(getComplementaryCategories('Cardigan')).not.toContain('Sweater');
    expect(getComplementaryCategories('Cardigan')).not.toContain('Shirt');
  });

  it('includes same-group categories that can be layered together', () => {
    expect(getComplementaryCategories('T-Shirt')).toContain('Sweater');
    expect(getComplementaryCategories('T-Shirt')).toContain('Shirt');
    expect(getComplementaryCategories('T-Shirt')).toContain('Cardigan');
    expect(getComplementaryCategories('Sweater')).toContain('Top');
  });

  it('always crosses groups regardless of layering', () => {
    // A sweater and a jacket are different slots, so they pair whether or not
    // the layering table has anything to say.
    expect(getComplementaryCategories('Sweater')).toContain('Jacket');
    expect(getComplementaryCategories('Sweater')).toContain('Bottom');
    expect(getComplementaryCategories('Coat')).toContain('Shoes');
  });

  it('agrees with the layering rules on every same-group pair', () => {
    for (const a of ALL_CATEGORIES) {
      for (const b of ALL_CATEGORIES) {
        if (a === b || CATEGORY_GROUP[a] !== CATEGORY_GROUP[b]) continue;
        expect(getComplementaryCategories(a).includes(b)).toBe(canLayerEitherWay(a, b));
      }
    }
  });

  it('gives a cardigan every category outside its group, plus the tops it layers with', () => {
    expect(getComplementaryCategories('Cardigan')).toEqual([
      'T-Shirt',
      'Top',
      'Jacket',
      'Coat',
      'Bottom',
      'Shoes',
      'Belt',
      'Bag',
      'Scarf',
    ]);
  });

  it('returns results in ALL_CATEGORIES order, so the UI ordering is stable', () => {
    for (const category of ALL_CATEGORIES) {
      const result = getComplementaryCategories(category);
      const positions = result.map((c) => ALL_CATEGORIES.indexOf(c));
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
    }
  });

  it('returns a fresh array so callers cannot mutate shared state', () => {
    const before = getComplementaryCategories('Bottom').length;
    getComplementaryCategories('Bottom').pop();
    expect(getComplementaryCategories('Bottom')).toHaveLength(before);
  });
});

describe('CATEGORY_GROUP', () => {
  it('classifies every category', () => {
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_GROUP[category]).toBeDefined();
    }
  });

  it('lists every category exactly once in ALL_CATEGORIES', () => {
    const keys = Object.keys(CATEGORY_GROUP) as Category[];
    expect([...ALL_CATEGORIES].sort()).toEqual(keys.sort());
    expect(new Set(ALL_CATEGORIES).size).toBe(ALL_CATEGORIES.length);
  });
});

describe('attribute applicability', () => {
  it('asks for hardware colour on belts and bags only', () => {
    expect(ALL_CATEGORIES.filter(hardwareColorApplies)).toEqual(['Belt', 'Bag']);
  });

  it('asks for belt loops on bottoms only', () => {
    expect(ALL_CATEGORIES.filter(beltLoopsApply)).toEqual(['Bottom']);
  });
});
