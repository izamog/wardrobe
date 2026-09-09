/** @jest-environment node */
import { collageLayout, isCutout } from '../outfitCollageLayout';
import type { Category, ClothingItem, GarmentLength } from '../../types/wardrobe';

function makeItem(id: string, category: Category, length: GarmentLength | '' = '', imagePath = `${id}.png`): ClothingItem {
  return {
    id,
    imagePath,
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
    length,
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: 'now',
    archivedAt: '',
    isWorkAppropriate: false,
  };
}

describe('isCutout', () => {
  it('treats a .png path as a background-removal cutout', () => {
    expect(isCutout('items/foo.png')).toBe(true);
  });

  it('treats a .jpg path as a plain, unremoved photo', () => {
    expect(isCutout('items/foo.jpg')).toBe(false);
  });

  it('is case-insensitive, matching isPng in services/images.ts', () => {
    expect(isCutout('items/foo.PNG')).toBe(true);
  });
});

describe('collageLayout', () => {
  it('gives Jacket a width of 2.3 boxes, centered on B2, free height', () => {
    const [rect] = collageLayout([makeItem('jacket', 'Jacket')]);
    expect(rect.left).toBe(7);
    expect(rect.width).toBe(46);
    expect(rect.top + rect.height / 2).toBeCloseTo(30);
    expect(rect.z).toBe(2);
  });

  it('gives Top a width of 1.5 boxes, centered on D2, when no Sweater/Cardigan is present', () => {
    const [rect] = collageLayout([makeItem('top', 'Top')]);
    expect(rect.left).toBe(55);
    expect(rect.width).toBe(30);
    expect(rect.top + rect.height / 2).toBeCloseTo(30);
    expect(rect.z).toBe(3);
  });

  it('gives T-Shirt a width of 2 boxes, centered on D2, when no Sweater/Cardigan is present', () => {
    const [rect] = collageLayout([makeItem('tshirt', 'T-Shirt')]);
    expect(rect.left).toBe(50);
    expect(rect.width).toBe(40);
    expect(rect.top + rect.height / 2).toBeCloseTo(30);
    expect(rect.z).toBe(3);
  });

  it('gives Shirt a width of 2.5 boxes, centered on D2, when no Sweater/Cardigan is present', () => {
    const [rect] = collageLayout([makeItem('shirt', 'Shirt')]);
    expect(rect.left).toBe(45);
    expect(rect.width).toBe(50);
    expect(rect.top + rect.height / 2).toBeCloseTo(30);
    expect(rect.z).toBe(3);
  });

  it('shifts Top/T-Shirt/Shirt to the C1/D1/C2/D2 intersection when a Sweater/Cardigan is also in the outfit, keeping each its own width', () => {
    const [shirtRect] = collageLayout([makeItem('shirt', 'Shirt'), makeItem('sweater', 'Sweater')]);
    expect(shirtRect.left).toBe(35); // 2.5-box width (50) centered on COLUMN_DIVIDER.CD (60)
    expect(shirtRect.width).toBe(50);
    expect(shirtRect.top + shirtRect.height / 2).toBeCloseTo(20);

    const [tshirtRect] = collageLayout([makeItem('tshirt', 'T-Shirt'), makeItem('cardigan', 'Cardigan')]);
    expect(tshirtRect.left).toBe(40); // 2-box width (40) centered on COLUMN_DIVIDER.CD (60)
    expect(tshirtRect.width).toBe(40);
    expect(tshirtRect.top + tshirtRect.height / 2).toBeCloseTo(20);
  });

  it('gives Sweater a width of 2.3 boxes, centered on D2', () => {
    const [rect] = collageLayout([makeItem('sweater', 'Sweater')]);
    expect(rect.left).toBe(47);
    expect(rect.width).toBe(46);
    expect(rect.top + rect.height / 2).toBeCloseTo(30);
    expect(rect.z).toBe(4);
  });

  it('gives Cardigan a width of 2 boxes (explicitly unchanged), centered on D2', () => {
    const [rect] = collageLayout([makeItem('cardigan', 'Cardigan')]);
    expect(rect.left).toBe(50);
    expect(rect.width).toBe(40);
    expect(rect.top + rect.height / 2).toBeCloseTo(30);
    expect(rect.z).toBe(4);
  });

  it('gives Shorts and a Mini skirt a width of 2 boxes, vertical center on the D3/D4 divider, free height', () => {
    const [shortsRect] = collageLayout([makeItem('shorts', 'Pants', 'Short')]);
    expect(shortsRect.left).toBe(50);
    expect(shortsRect.width).toBe(40);
    expect(shortsRect.top + shortsRect.height / 2).toBeCloseTo(60);

    const [miniRect] = collageLayout([makeItem('mini', 'Skirt', 'Mini')]);
    expect(miniRect.left).toBe(50);
    expect(miniRect.width).toBe(40);
  });

  it('gives long pants, knee-length pants, midi/maxi skirts and leggings a width of 2 boxes (same as Shorts), vertical center on the D3/D4 divider', () => {
    const cases: [Category, GarmentLength | ''][] = [
      ['Pants', 'Long'],
      ['Pants', 'Mid-length'],
      ['Pants', 'Capri'],
      ['Pants', 'Cropped'],
      ['Skirt', 'Midi'],
      ['Skirt', 'Maxi'],
      ['Skirt', 'Knee-length'],
      ['Leggings', ''],
    ];
    for (const [category, length] of cases) {
      const [rect] = collageLayout([makeItem('bottom', category, length)]);
      expect(rect.left).toBe(50);
      expect(rect.width).toBe(40);
      expect(rect.top + rect.height / 2).toBeCloseTo(60);
    }
  });

  it('gives Bag a width of 2 boxes, centered on B3, free height, drawn near the top of the stack', () => {
    const [rect] = collageLayout([makeItem('bag', 'Bag')]);
    expect(rect.left).toBe(10);
    expect(rect.width).toBe(40);
    expect(rect.top + rect.height / 2).toBeCloseTo(50);
    expect(rect.z).toBe(9);
  });

  it('gives Shoes (and Boots/Sandals) a width of 2 boxes, centered on column B, vertical center on the B4/B5 divider', () => {
    for (const category of ['Shoes', 'Boots', 'Sandals'] as const) {
      const [rect] = collageLayout([makeItem('shoe', category)]);
      expect(rect.left).toBe(10);
      expect(rect.width).toBe(40);
      expect(rect.top + rect.height / 2).toBeCloseTo(80);
    }
  });

  it('gives Coat a width of 2.3 boxes, vertical center on the B2/B3 divider, free height', () => {
    const [rect] = collageLayout([makeItem('coat', 'Coat')]);
    expect(rect.left).toBe(7);
    expect(rect.width).toBe(46);
    expect(rect.top + rect.height / 2).toBeCloseTo(40);
  });

  it('fits Dress within 1.25x3 boxes, centered on D3', () => {
    const [rect] = collageLayout([makeItem('dress', 'Dress')]);
    expect(rect).toEqual({ top: 20, left: 57.5, width: 25, height: 60, z: 5 });
  });

  it('gives Belt a width of 1.5 boxes, vertical center on the D2/D3 divider, drawn topmost', () => {
    const [rect] = collageLayout([makeItem('belt', 'Belt')]);
    expect(rect.left).toBe(55);
    expect(rect.width).toBe(30);
    expect(rect.top + rect.height / 2).toBeCloseTo(40);
    expect(rect.z).toBeGreaterThan(9); // above Bag (9), the only other "topmost" item
  });

  it('gives Scarf a width of 0.75 boxes, vertical center on row 2, horizontal center on the A/B divider, above outerwear', () => {
    const [scarfRect, jacketRect] = collageLayout([makeItem('scarf', 'Scarf'), makeItem('jacket', 'Jacket')]);
    expect(scarfRect.left).toBe(12.5);
    expect(scarfRect.width).toBe(15);
    expect(scarfRect.top + scarfRect.height / 2).toBeCloseTo(30);
    expect(scarfRect.z).toBeGreaterThan(jacketRect.z);
  });

  it('gives Tights a full box width, centered on E4', () => {
    const [rect] = collageLayout([makeItem('tights', 'Tights')]);
    expect(rect.left).toBe(80);
    expect(rect.width).toBe(20);
    expect(rect.top + rect.height / 2).toBeCloseTo(70);
  });

  it('stacks Dress below Belt but above Top', () => {
    const [dressRect, beltRect, topRect] = collageLayout([makeItem('dress', 'Dress'), makeItem('belt', 'Belt'), makeItem('top', 'Top')]);
    expect(dressRect.z).toBeLessThan(beltRect.z);
    expect(dressRect.z).toBeGreaterThan(topRect.z);
  });

  it('cascades multiple items sharing a bucket instead of stacking them identically', () => {
    // buildSlots (outfitSlots.ts) can put a Base Layer tee and a main Top in
    // one outfit at once, and baseLayerCandidates places no restriction on
    // which *other* Top-group item the main Top slot picks — a T-Shirt base
    // layer alongside a T-Shirt main Top both land in the 'tshirt' bucket.
    // (Top and Shirt are separate buckets now, so a base-layer T-Shirt
    // alongside a Top- or Shirt-category main item no longer cascades with
    // it at all — see the module's own doc comment on CASCADE_STAGGER_FRACTION.)
    const items = [makeItem('base-layer', 'T-Shirt'), makeItem('main-top', 'T-Shirt')];
    const rects = collageLayout(items);
    expect(rects[0]).not.toEqual(rects[1]);
    // The last item is the outermost layer: full bucket size, on top, at
    // exactly the bucket's own (un-staggered) box.
    expect(rects[1].left).toBe(50);
    expect(rects[1].width).toBe(40);
    expect(rects[0].width).toBeLessThan(rects[1].width);
    expect(rects[0].z).toBeLessThan(rects[1].z);
  });

  it('stays sane even for a width-only bucket: cascade offsets scale with width, not the huge free-axis height', () => {
    // A regression guard for a real bug: cascadeWithinBucket used to stagger
    // by a fraction of base.height, which is harmless for a dual-capped
    // "contain" box (Jacket) but was hundreds of percent for a width-only
    // box's artificially tall free axis (see GENEROUS_FREE_AXIS) — enough to
    // fling a cascaded item's top/left far from the outer item's, rather than
    // the few percent a cascade should ever move something by.
    const items = [makeItem('base-layer', 'T-Shirt'), makeItem('main-top', 'T-Shirt')];
    const [backRect, frontRect] = collageLayout(items);
    expect(Math.abs(backRect.top - frontRect.top)).toBeLessThan(10);
    expect(Math.abs(backRect.left - frontRect.left)).toBeLessThan(10);
  });

  it('gives width-only items a generous enough free-axis height that a tall, narrow garment photo never gets height-constrained instead', () => {
    // A tightly-cropped maxi skirt or long pants cutout can realistically be
    // much taller than it is wide — height:width beyond 4:1 isn't unusual
    // for a full-length garment. At the stated 2-box (40%) width, that needs
    // up to 40% * 4+ = 160%+ of canvas height just to preserve aspect —
    // which is exactly what an earlier, insufficiently generous free-axis
    // box (100% tall) could fail to cover, silently shrinking the rendered
    // width below the spec instead of letting height overflow off-canvas.
    const [rect] = collageLayout([makeItem('maxi', 'Skirt', 'Maxi')]);
    expect(rect.height).toBeGreaterThan(1000);
  });

  /**
   * The box's true pixel aspect ratio (width:height, both converted to the
   * same units via the 3:4 canvas) — the number that actually determines
   * whether resizeMode="contain" binds on width (correct) or height
   * (silently shrinks the rendered width below spec). See widthOnlyBox and
   * GENEROUS_FREE_AXIS's own doc comment for why this, not the raw height
   * percentage, is what has to stay small.
   */
  function truePixelAspect(rect: { width: number; height: number }): number {
    return rect.width / (rect.height * (4 / 3));
  }

  it('keeps every width-only box narrow enough to fit a real, tall/narrow garment photo without height-binding', () => {
    // Measured directly from a real device screenshot with the grid
    // overlaid (not guessed): a plain T-Shirt cutout came out at roughly a
    // 1:9.5 aspect ratio, and a pair of jeans at roughly 1:16 — both far
    // narrower than an earlier, insufficiently generous free-axis (150) could
    // cover, which is exactly what silently shrank them below their box
    // target on a real phone despite every unit test passing. This asserts
    // against those real measurements with margin, not a guessed threshold.
    const MEASURED_WORST_CASE_ASPECT = 1 / 16;
    const SAFETY_MARGIN = 2;

    const items = [
      makeItem('top', 'Top'),
      makeItem('sweater', 'Sweater'),
      makeItem('bottom', 'Pants', 'Long'),
      makeItem('belt', 'Belt'),
      makeItem('tights', 'Tights'),
      makeItem('coat', 'Coat'),
    ];
    for (const rect of collageLayout(items)) {
      expect(truePixelAspect(rect)).toBeLessThan(MEASURED_WORST_CASE_ASPECT / SAFETY_MARGIN);
    }
  });

  it('returns one rect per item, in the same order as the input', () => {
    const jacket = makeItem('a', 'Jacket');
    const shorts = makeItem('b', 'Pants', 'Short');
    const shoes = makeItem('c', 'Shoes');
    const rects = collageLayout([jacket, shorts, shoes]);
    expect(rects).toHaveLength(3);

    // Same items, reversed input order, should produce the same three rects
    // (matched by category, since bucket assignment — not input position —
    // determines a rect) but in reverse order in the returned array.
    const reversed = collageLayout([shoes, shorts, jacket]);
    expect(reversed).toEqual([rects[2], rects[1], rects[0]]);
  });
});
