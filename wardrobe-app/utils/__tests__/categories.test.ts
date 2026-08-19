import { ALL_CATEGORIES, getComplementaryCategories } from '../categories';
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
    const garments: Category[] = ['Top', 'Bottom', 'Outerwear', 'Shoes', 'Belt'];
    expect(getComplementaryCategories('Bag')).toEqual(garments);
    expect(getComplementaryCategories('Scarf')).toEqual(garments);
  });

  it('offers a garment every category but itself, accessories included', () => {
    expect(getComplementaryCategories('Top')).toEqual([
      'Bottom',
      'Outerwear',
      'Shoes',
      'Belt',
      'Bag',
      'Scarf',
    ]);
    expect(getComplementaryCategories('Belt')).toEqual([
      'Top',
      'Bottom',
      'Outerwear',
      'Shoes',
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
    const first = getComplementaryCategories('Top');
    first.pop();
    expect(getComplementaryCategories('Top')).toHaveLength(6);
  });
});
