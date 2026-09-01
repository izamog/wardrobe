/** @jest-environment node */
import { tightsEligible, TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR } from '../outfitSlots';
import type { ClothingItem } from '../../types/wardrobe';

function anchor(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id: 'a',
    imagePath: '',
    originalImagePath: '',
    imageMarginBaked: false,
    category: 'Pants',
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

describe('tightsEligible', () => {
  it('is false at warmthFloor 0, regardless of anchor category', () => {
    expect(tightsEligible(anchor({ category: 'Skirt' }), 0)).toBe(false);
    expect(tightsEligible(anchor({ category: 'Dress' }), 0)).toBe(false);
  });

  it('is true under a Skirt or Dress anchor whenever warmthFloor is above 0', () => {
    expect(tightsEligible(anchor({ category: 'Skirt' }), 1)).toBe(true);
    expect(tightsEligible(anchor({ category: 'Dress' }), 1)).toBe(true);
  });

  it('is true under Pants/Leggings only above TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR', () => {
    expect(tightsEligible(anchor({ category: 'Pants' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR)).toBe(false);
    expect(tightsEligible(anchor({ category: 'Pants' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR + 1)).toBe(true);
    expect(tightsEligible(anchor({ category: 'Leggings' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR + 1)).toBe(true);
  });
});
