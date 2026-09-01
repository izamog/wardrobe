/** @jest-environment node */
import { dropAccessoryFreeDuplicates, dropExactDuplicates } from '../outfitDedup';
import type { Category, ClothingItem } from '../../types/wardrobe';

function makeItem(id: string, category: Category): ClothingItem {
  return {
    id,
    imagePath: `${id}.png`,
    originalImagePath: '',
    imageMarginBaked: false,
    thickness: 'Regular',
    denier: 0,
    backless: false,
    primaryColor: '',
    secondaryColor: '',
    category,
    brand: '',
    costMinorUnits: 0,
    isSecondHand: false,
    purchasedAt: '',
    materials: [],
    hardwareColor: 'None',
    hasBeltLoops: false,
    sleeveLength: 'Short',
    length: '',
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: 'now',
    archivedAt: '',
    isWorkAppropriate: false,
  };
}

describe('dropExactDuplicates', () => {
  it('keeps the first of two outfits with the same items in a different order', () => {
    const top = makeItem('top', 'Top');
    const bottom = makeItem('bottom', 'Pants');
    const a = { items: [top, bottom] };
    const b = { items: [bottom, top] };
    expect(dropExactDuplicates([a, b])).toEqual([a]);
  });
});

describe('dropAccessoryFreeDuplicates', () => {
  const top = makeItem('top', 'Top');
  const bottom = makeItem('bottom', 'Pants');
  const bag = makeItem('bag', 'Bag');
  const scarf = makeItem('scarf', 'Scarf');

  it('drops a bare outfit once its accessorized twin (same core, plus a bag) is present and better-or-equal', () => {
    const bare = { items: [top, bottom] };
    const withBag = { items: [top, bottom, bag] };
    const result = dropAccessoryFreeDuplicates([bare, withBag], () => true);
    expect(result).toEqual([withBag]);
  });

  it('keeps the bare outfit when isBetterOrEqual rejects the accessorized twin', () => {
    const bare = { items: [top, bottom] };
    const withBag = { items: [top, bottom, bag] };
    const result = dropAccessoryFreeDuplicates([bare, withBag], (outfit) => outfit !== withBag);
    expect(result).toEqual([bare, withBag]);
  });

  it('never drops two outfits whose non-accessory items differ, even if one has more accessories', () => {
    const otherTop = makeItem('other-top', 'Shirt');
    const outfitA = { items: [top, bottom] };
    const outfitB = { items: [otherTop, bottom, bag] };
    const result = dropAccessoryFreeDuplicates([outfitA, outfitB], () => true);
    expect(result).toEqual([outfitA, outfitB]);
  });

  it('only drops a subset whose extra items are all accessory-group (Bag/Scarf/Tights)', () => {
    // A different Cardigan is a structural difference, not an accessory —
    // isAccessorySuperset (and so dropAccessoryFreeDuplicates) must not treat
    // outfitB as a superset of outfitA here.
    const cardigan = makeItem('cardigan', 'Cardigan');
    const outfitA = { items: [top, bottom] };
    const outfitB = { items: [top, bottom, cardigan] };
    const result = dropAccessoryFreeDuplicates([outfitA, outfitB], () => true);
    expect(result).toEqual([outfitA, outfitB]);
  });

  it('drops a twin missing just a scarf even when a differently-cored bucket of outfits sits alongside it', () => {
    const bare = { items: [top, bottom] };
    const withScarf = { items: [top, bottom, scarf] };
    const unrelated = { items: [makeItem('other-top', 'Shirt'), bottom] };
    const result = dropAccessoryFreeDuplicates([bare, withScarf, unrelated], () => true);
    expect(result).toEqual([withScarf, unrelated]);
  });

  it(
    'stays fast for a large result set dominated by many distinct core outfits ' +
      '(regression guard: an all-pairs O(n²) comparison here is what made the ' +
      'troubleshoot-weather sliders take minutes on a well-stocked closet)',
    () => {
      // generateClosestOutfits deliberately runs an uncapped search (see its
      // own doc comment) and can hand this tens of thousands of raw outfits.
      // Each one here has a distinct core (a unique top+bottom pairing), so a
      // correct bucketed implementation does O(n) work; the old all-pairs
      // version would take this test from milliseconds to tens of seconds.
      const items: { items: ClothingItem[] }[] = [];
      for (let i = 0; i < 20000; i++) {
        items.push({
          items: [makeItem(`top-${i}`, 'Top'), makeItem(`bottom-${i}`, 'Pants')],
        });
      }
      const start = Date.now();
      const result = dropAccessoryFreeDuplicates(items, () => true);
      expect(Date.now() - start).toBeLessThan(2000);
      expect(result).toHaveLength(items.length);
    },
  );
});
