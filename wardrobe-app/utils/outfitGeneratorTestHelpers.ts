import type { Category, ClothingItem, HardwareColor } from '../types/wardrobe';
import type { OutfitCandidates } from './outfitGenerator';

let seq = 0;

/** Call from each test file's own beforeEach — seq is shared across every caller of item(). */
export function resetSeq() {
  seq = 0;
}

export const item = (
  category: Category,
  overrides: Partial<
    Pick<ClothingItem, 'hasBeltLoops' | 'hardwareColor' | 'inferredWarmth' | 'inferredWind'>
  > = {},
): ClothingItem => {
  seq += 1;
  return {
    id: `${category}-${seq}`,
    imagePath: '',
    originalImagePath: '',
    primaryColor: '',
    secondaryColor: '',
    category,
    brand: `brand${seq}`,
    costMinorUnits: 0,
    isSecondHand: false,
    materials: [],
    hardwareColor: 'None' as HardwareColor,
    hasBeltLoops: false,
    sleeveLength: 'Short',
    length: '',
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: 'now',
    ...overrides,
  };
};

export function emptyCandidates(overrides: Partial<OutfitCandidates> = {}): OutfitCandidates {
  return {
    bottoms: [],
    tops: [],
    shoes: [],
    outerwear: [],
    scarves: [],
    belts: [],
    bags: [],
    ...overrides,
  };
}

/** A generous ceiling for tests that only care about the floor. */
export const NO_CEILING = 1000;

export const noDismatches = new Set<string>();
