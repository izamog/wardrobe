/** @jest-environment node */
import { sortItems } from '../closetSort';
import type { ClothingItem } from '../../types/wardrobe';

function item(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id: 'id',
    imagePath: '',
    originalImagePath: '',
    imageMarginBaked: false,
    primaryColor: '',
    secondaryColor: '',
    category: 'Top',
    brand: 'Unknown',
    costMinorUnits: 0,
    isSecondHand: false,
    purchasedAt: '',
    materials: [],
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
    createdAt: 'now',
    archivedAt: '',
    isWorkAppropriate: false,
    ...overrides,
  };
}

describe('sortItems', () => {
  it('leaves "newest" order untouched, as a copy rather than the same array', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' })];
    const sorted = sortItems(items, 'newest');
    expect(sorted).toEqual(items);
    expect(sorted).not.toBe(items);
  });

  it('sorts by price ascending', () => {
    const cheap = item({ id: 'cheap', costMinorUnits: 500 });
    const pricey = item({ id: 'pricey', costMinorUnits: 9999 });
    expect(sortItems([pricey, cheap], 'price')).toEqual([cheap, pricey]);
  });

  it('sorts by date bought, most recent first, with never-recorded dates last', () => {
    const old = item({ id: 'old', purchasedAt: '2020-01' });
    const recent = item({ id: 'recent', purchasedAt: '2026-06' });
    const unrecorded = item({ id: 'unrecorded', purchasedAt: '' });
    expect(sortItems([unrecorded, old, recent], 'dateBought')).toEqual([recent, old, unrecorded]);
  });

  it('sorts by brand alphabetically, with the "Unknown" default last', () => {
    const zed = item({ id: 'zed', brand: 'Zed & Co' });
    const acme = item({ id: 'acme', brand: 'Acme' });
    const unbranded = item({ id: 'unbranded', brand: 'Unknown' });
    expect(sortItems([zed, unbranded, acme], 'brand')).toEqual([acme, zed, unbranded]);
  });

  it('sorts by colour alphabetically, with an unset colour last', () => {
    const navy = item({ id: 'navy', primaryColor: 'Navy' });
    const black = item({ id: 'black', primaryColor: 'Black' });
    const unset = item({ id: 'unset', primaryColor: '' });
    expect(sortItems([navy, unset, black], 'colour')).toEqual([black, navy, unset]);
  });
});
