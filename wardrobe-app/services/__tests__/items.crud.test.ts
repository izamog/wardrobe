/** @jest-environment node */
import type { MaterialEntry } from '../../types/wardrobe';
import { getItem, insertItem, listItems, listItemsInCategories, rowToItem, updateItem } from '../items';
import { draft, freshDb } from '../itemsTestHelpers';

describe('insertItem / getItem', () => {
  it('round-trips every field through SQLite', async () => {
    const db = await freshDb();
    const written = await insertItem(
      db,
      draft({
        imagePath: 'items/shirt.jpg',
        originalImagePath: 'items/shirt-original.jpg',
        category: 'Pants',
        brand: 'Levis',
        costMinorUnits: 4599,
        isSecondHand: true,
        materials: [
          { material: 'cotton', percent: 80 },
          { material: 'elastane', percent: 20 },
        ],
        primaryColor: 'Navy',
        secondaryColor: 'Cream',
        hardwareColor: 'Silver',
        hasBeltLoops: true,
        inferredWarmth: 3,
        inferredWind: 2,
      }),
      'id-1',
      '2026-01-01T00:00:00.000Z',
    );

    expect(await getItem(db, 'id-1')).toEqual(written);
  });

  it('starts new items unworn', async () => {
    const db = await freshDb();
    const item = await insertItem(db, draft(), 'id-1', '2026-01-01T00:00:00.000Z');
    expect(item.wearCount).toBe(0);
  });

  it('returns null for an unknown id', async () => {
    const db = await freshDb();
    expect(await getItem(db, 'nope')).toBeNull();
  });

  it('still rejects values the CHECK constraints forbid', async () => {
    const db = await freshDb();
    await expect(
      insertItem(db, draft({ inferredWarmth: 99 }), 'id-1', '2026-01-01T00:00:00.000Z'),
    ).rejects.toThrow();
  });

  it('truncates materials to MAX_MATERIALS on write, including in the returned item', async () => {
    const db = await freshDb();
    const materials = [
      { material: 'cotton', percent: 50 },
      { material: 'wool', percent: 30 },
      { material: 'elastane', percent: 20 },
    ];
    const written = await insertItem(db, draft({ materials }), 'id-1', '2026-01-01T00:00:00.000Z');

    expect(written.materials).toEqual(materials.slice(0, 2));
    expect((await getItem(db, 'id-1'))?.materials).toEqual(materials.slice(0, 2));
  });
});

describe('rowToItem', () => {
  // The columns are TEXT/INTEGER, so booleans and materials need decoding —
  // a raw row cast to ClothingItem would be wrong about exactly these fields.
  it('decodes INTEGER booleans and JSON materials', () => {
    const item = rowToItem({
      id: 'a',
      imagePath: '',
      originalImagePath: '',
      imageMarginBaked: 0,
      primaryColor: 'Navy',
      secondaryColor: '',
      category: 'Top',
      brand: 'b',
      costMinorUnits: 0,
      isSecondHand: 1,
      purchasedAt: '',
      materials: '["wool"]',
      hardwareColor: 'Gold',
      hasBeltLoops: 0,
      sleeveLength: 'Short',
      length: '',
      thickness: 'Regular',
      denier: 0,
      backless: 0,
      inferredWarmth: 0,
      inferredWind: 0,
      wearCount: 0,
      createdAt: 'now',
      archivedAt: '',
      isWorkAppropriate: 0,
    });

    expect(item.isSecondHand).toBe(true);
    expect(item.hasBeltLoops).toBe(false);
    expect(item.materials).toEqual([{ material: 'wool', percent: 0 }]);
  });

  it('falls back to an empty list rather than throwing on unreadable materials, and decodes a legacy plain-string entry as percent 0', () => {
    const base = {
      id: 'a',
      imagePath: '',
      originalImagePath: '',
      imageMarginBaked: 0,
      primaryColor: '',
      secondaryColor: '',
      category: 'Top',
      brand: 'b',
      costMinorUnits: 0,
      isSecondHand: 0,
      purchasedAt: '',
      hardwareColor: 'None',
      hasBeltLoops: 0,
      sleeveLength: 'Short',
      length: '',
      thickness: 'Regular',
      denier: 0,
      backless: 0,
      inferredWarmth: 0,
      inferredWind: 0,
      wearCount: 0,
      createdAt: 'now',
      archivedAt: '',
      isWorkAppropriate: 0,
    };
    expect(rowToItem({ ...base, materials: 'not json' }).materials).toEqual([]);
    expect(rowToItem({ ...base, materials: '{"a":1}' }).materials).toEqual([]);
    expect(rowToItem({ ...base, materials: '["ok", 7]' }).materials).toEqual([{ material: 'ok', percent: 0 }]);
    expect(
      rowToItem({ ...base, materials: '[{"material":"wool","percent":60}]' }).materials,
    ).toEqual([{ material: 'wool', percent: 60 }]);
  });

  it('clamps a malformed stored percent rather than passing it through to warmth math', () => {
    const base = {
      id: 'a',
      imagePath: '',
      originalImagePath: '',
      imageMarginBaked: 0,
      primaryColor: '',
      secondaryColor: '',
      category: 'Top',
      brand: 'b',
      costMinorUnits: 0,
      isSecondHand: 0,
      purchasedAt: '',
      hardwareColor: 'None',
      hasBeltLoops: 0,
      sleeveLength: 'Short',
      length: '',
      thickness: 'Regular',
      denier: 0,
      backless: 0,
      inferredWarmth: 0,
      inferredWind: 0,
      wearCount: 0,
      createdAt: 'now',
      archivedAt: '',
      isWorkAppropriate: 0,
    };
    expect(
      rowToItem({ ...base, materials: '[{"material":"wool","percent":250}]' }).materials,
    ).toEqual([{ material: 'wool', percent: 100 }]);
    expect(
      rowToItem({ ...base, materials: '[{"material":"wool","percent":-5}]' }).materials,
    ).toEqual([{ material: 'wool', percent: 0 }]);
    expect(
      rowToItem({ ...base, materials: '[{"material":"wool","percent":"60"}]' }).materials,
    ).toEqual([{ material: 'wool', percent: 0 }]);
    expect(
      rowToItem({ ...base, materials: '[{"material":"wool","percent":60.7}]' }).materials,
    ).toEqual([{ material: 'wool', percent: 61 }]);
  });
});

describe('listItems', () => {
  it('returns newest first', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'old', '2026-01-01T00:00:00.000Z');
    await insertItem(db, draft(), 'new', '2026-06-01T00:00:00.000Z');

    expect((await listItems(db)).map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('narrows to one category, and null means all', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top', '2026-01-01T00:00:00.000Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes', '2026-01-02T00:00:00.000Z');

    expect((await listItems(db, 'Shoes')).map((i) => i.id)).toEqual(['shoes']);
    expect((await listItems(db, null)).map((i) => i.id).sort()).toEqual(['shoes', 'top']);
  });
});

describe('listItemsInCategories', () => {
  it('returns items from any of the given categories, newest first', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top', '2026-01-01T00:00:00.000Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes', '2026-01-03T00:00:00.000Z');
    await insertItem(db, draft({ category: 'Bag' }), 'bag', '2026-01-02T00:00:00.000Z');

    const found = await listItemsInCategories(db, ['Top', 'Bag']);
    expect(found.map((i) => i.id)).toEqual(['bag', 'top']);
  });

  it('returns nothing for an empty category list', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'top', 'now');
    expect(await listItemsInCategories(db, [])).toEqual([]);
  });
});

describe('updateItem', () => {
  it('writes only the fields present in the update', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ brand: 'Original', costMinorUnits: 100 }), 'id-1', 'now');

    await updateItem(db, 'id-1', { brand: 'Renamed' });

    const item = await getItem(db, 'id-1');
    expect(item?.brand).toBe('Renamed');
    expect(item?.costMinorUnits).toBe(100);
  });

  it('re-encodes booleans and materials on the way back down', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'id-1', 'now');

    await updateItem(db, 'id-1', { isSecondHand: true, materials: [{ material: 'linen', percent: 0 }] });

    const item = await getItem(db, 'id-1');
    expect(item?.isSecondHand).toBe(true);
    expect(item?.materials).toEqual([{ material: 'linen', percent: 0 }]);
  });

  it('truncates materials to MAX_MATERIALS on update too, not just insert', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'id-1', 'now');
    const materials = [
      { material: 'cotton', percent: 50 },
      { material: 'wool', percent: 30 },
      { material: 'silk', percent: 20 },
    ];

    await updateItem(db, 'id-1', { materials });

    expect((await getItem(db, 'id-1'))?.materials).toEqual(materials.slice(0, 2));
  });

  it('clamps an out-of-range percent at write time too, not just on the way back out', async () => {
    // A bypassed or future caller (a bulk import, a bug elsewhere in the
    // form) isn't guaranteed to hand insertItem/updateItem a percent
    // MaterialEntry's own type already rules out at compile time -- the
    // `as` casts below simulate exactly that caller. Without normalizing on
    // write, a bad value would sit in the database in an invalid shape until
    // the next read's decodeMaterials clamp caught it.
    const db = await freshDb();
    await insertItem(
      db,
      draft({ materials: [{ material: 'wool', percent: 250 } as unknown as MaterialEntry] }),
      'id-1',
      'now',
    );
    expect((await getItem(db, 'id-1'))?.materials).toEqual([{ material: 'wool', percent: 100 }]);

    await updateItem(db, 'id-1', {
      materials: [{ material: 'wool', percent: -30 } as unknown as MaterialEntry],
    });
    expect((await getItem(db, 'id-1'))?.materials).toEqual([{ material: 'wool', percent: 0 }]);
  });

  it('persists denier, backless and a recomputed inferredWarmth together, and a fresh read reflects all three', async () => {
    // Regression for a reported bug: editing a Tights item's denier (and a
    // Top/Dress's backless flag) looked like it saved -- the edit screen
    // showed the new value -- but reopening the item showed the old one
    // again. The screen-level cause was EstimatesEditor being reachable
    // outside an editing session with no save path; this covers the actual
    // persistence layer underneath it, so a regression there would be caught
    // even if the screen-level fix were ever undone.
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Tights', denier: 0, inferredWarmth: 1 }), 'id-1', 'now');

    await updateItem(db, 'id-1', { denier: 150, inferredWarmth: 6 });

    const reopened = await getItem(db, 'id-1');
    expect(reopened?.denier).toBe(150);
    expect(reopened?.inferredWarmth).toBe(6);
  });

  it('persists backless alongside its recomputed inferredWarmth and inferredWind', async () => {
    const db = await freshDb();
    await insertItem(
      db,
      draft({ category: 'Top', backless: false, inferredWarmth: 3, inferredWind: 2 }),
      'id-1',
      'now',
    );

    await updateItem(db, 'id-1', { backless: true, inferredWarmth: 2, inferredWind: 0 });

    const reopened = await getItem(db, 'id-1');
    expect(reopened?.backless).toBe(true);
    expect(reopened?.inferredWarmth).toBe(2);
    expect(reopened?.inferredWind).toBe(0);
  });

  it('is a no-op for an empty update rather than emitting invalid SQL', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ brand: 'Original' }), 'id-1', 'now');

    await expect(updateItem(db, 'id-1', {})).resolves.toBeUndefined();
    expect((await getItem(db, 'id-1'))?.brand).toBe('Original');
  });

  it('repoints both image columns, which replacing a photo depends on', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ imagePath: 'items/a.jpg', originalImagePath: 'items/a.jpg' }), 'id-1', 'now');

    await updateItem(db, 'id-1', {
      imagePath: 'items/a-2.jpg',
      originalImagePath: 'items/a-2.jpg',
    });

    const item = await getItem(db, 'id-1');
    expect(item?.imagePath).toBe('items/a-2.jpg');
    expect(item?.originalImagePath).toBe('items/a-2.jpg');
  });

  it('does not let an update bypass the CHECK constraints', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'id-1', 'now');
    await expect(updateItem(db, 'id-1', { inferredWind: -1 })).rejects.toThrow();
  });
});

