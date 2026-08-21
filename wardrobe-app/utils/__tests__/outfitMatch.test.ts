/** @jest-environment node */
import { filterKnownIds, selectOutfitCandidates } from '../outfitMatch';
import type { Category, ClothingItem } from '../../types/wardrobe';

const item = (id: string, category: Category = 'Top'): ClothingItem => ({
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
});

describe('selectOutfitCandidates', () => {
  it('keeps everything when under the limit', () => {
    const items = [item('a'), item('b')];
    expect(selectOutfitCandidates(items, 5)).toEqual(items);
  });

  it('caps at the limit, keeping the front of the list', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(selectOutfitCandidates(items, 2).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('defaults to MAX_OUTFIT_CANDIDATES when no limit is given', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(`i${i}`));
    expect(selectOutfitCandidates(items)).toHaveLength(30);
  });
});

describe('filterKnownIds', () => {
  const valid = new Set(['a', 'b', 'c']);

  it('keeps only ids that were offered as candidates', () => {
    expect(filterKnownIds(['a', 'z', 'c'], valid)).toEqual(['a', 'c']);
  });

  it('drops duplicates, keeping the first occurrence', () => {
    expect(filterKnownIds(['a', 'a', 'b'], valid)).toEqual(['a', 'b']);
  });

  it('rejects non-string entries', () => {
    expect(filterKnownIds(['a', 1, null, {}], valid)).toEqual(['a']);
  });

  it('returns nothing when the input is not an array', () => {
    expect(filterKnownIds(null, valid)).toEqual([]);
    expect(filterKnownIds('a', valid)).toEqual([]);
    expect(filterKnownIds(undefined, valid)).toEqual([]);
  });
});
