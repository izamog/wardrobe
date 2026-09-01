/**
 * @jest-environment node
 *
 * The query and mapping functions take the structural ItemsDatabase interface,
 * so these tests run the real SQL against node:sqlite over the real migration
 * schema. Only the driver differs from what the app runs; the CHECK
 * constraints, the FK cascade and the canonical-order rule are all live.
 */
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, type MigratableDatabase } from '../migrations';
import type { MaterialEntry } from '../../types/wardrobe';
import {
  archiveItems,
  canonicalPair,
  clearCompatibility,
  deleteItem,
  getCompatibility,
  getDismatchedPairKeys,
  getItem,
  getLatestLoggedOutfit,
  getVerdictsFor,
  insertItem,
  listArchivedItems,
  listExpiredArchivedItems,
  listItems,
  listItemsByIds,
  listItemsInCategories,
  listItemsWornOn,
  listLoggedOutfitsInRange,
  listRatedPairKeys,
  logOutfitWorn,
  recentWearDays,
  removeOutfitLogs,
  replaceOutfitLog,
  restoreItem,
  rowToItem,
  setCompatibility,
  setItemFlags,
  updateItem,
  type ItemsDatabase,
  type NewClothingItem,
} from '../items';

function adaptForMigrations(db: DatabaseSync): MigratableDatabase {
  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      return (db.prepare(sql).get() ?? null) as T | null;
    },
    withTransactionAsync: async (fn) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function adapt(db: DatabaseSync): ItemsDatabase {
  return {
    runAsync: async (sql, params) => db.prepare(sql).run(...params),
    async getAllAsync<T>(sql: string, params: (string | number | null)[]): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: (string | number | null)[]): Promise<T | null> {
      return (db.prepare(sql).get(...params) ?? null) as T | null;
    },
    async withTransactionAsync(fn) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

async function freshDb(): Promise<ItemsDatabase> {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  await runMigrations(adaptForMigrations(raw));
  return adapt(raw);
}

const draft = (overrides: Partial<NewClothingItem> = {}): NewClothingItem => ({
  imagePath: '',
  originalImagePath: '',
  imageMarginBaked: false,
  primaryColor: '',
  secondaryColor: '',
  category: 'Top',
  brand: 'Unbranded',
  costMinorUnits: 0,
  isSecondHand: false,
  isWorkAppropriate: false,
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
  ...overrides,
});

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

describe('deleteItem', () => {
  it('takes the item and its verdicts with it', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'bbb', 'now');
    await setVerdict(db, 'aaa', 'bbb');

    await deleteItem(db, 'aaa');

    expect(await getItem(db, 'aaa')).toBeNull();
    expect(await getVerdictsFor(db, 'bbb')).toEqual(new Map());
  });
});

// setCompatibility generates an id by default, which is a native call, so the
// tests always pass one.
let verdictSeq = 0;
const setVerdict = (
  db: ItemsDatabase,
  x: string,
  y: string,
  status: 'MATCH' | 'DISMATCH' = 'MATCH',
) => setCompatibility(db, x, y, status, `verdict-${verdictSeq++}`, '2026-01-01T00:00:00.000Z');

describe('compatibility', () => {
  it('stores a pair under one key whichever order it is given in', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');

    await setVerdict(db, 'zzz', 'aaa', 'MATCH');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBe('MATCH');
    expect(await getCompatibility(db, 'zzz', 'aaa')).toBe('MATCH');
  });

  it('replaces a verdict rather than failing the UNIQUE constraint', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');

    await setVerdict(db, 'aaa', 'zzz', 'MATCH');
    await setVerdict(db, 'zzz', 'aaa', 'DISMATCH');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBe('DISMATCH');
  });

  it('reports an unrated pair as null', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBeNull();
  });

  it('returns a pair to unrated when cleared', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'zzz', 'now');
    await setVerdict(db, 'aaa', 'zzz');

    await clearCompatibility(db, 'zzz', 'aaa');

    expect(await getCompatibility(db, 'aaa', 'zzz')).toBeNull();
  });

  it('keys verdicts by the other item, from either side of the pair', async () => {
    const db = await freshDb();
    await insertItem(db, draft(), 'mmm', 'now');
    await insertItem(db, draft({ category: 'Shoes' }), 'aaa', 'now');
    await insertItem(db, draft({ category: 'Bag' }), 'zzz', 'now');

    // 'mmm' sorts after 'aaa' and before 'zzz', so it lands in a different
    // column in each row.
    await setVerdict(db, 'mmm', 'aaa', 'MATCH');
    await setVerdict(db, 'mmm', 'zzz', 'DISMATCH');

    expect(await getVerdictsFor(db, 'mmm')).toEqual(
      new Map([
        ['aaa', 'MATCH'],
        ['zzz', 'DISMATCH'],
      ]),
    );
  });
});

describe('canonicalPair', () => {
  it('orders a pair the same way regardless of argument order', () => {
    expect(canonicalPair('b', 'a')).toEqual(['a', 'b']);
    expect(canonicalPair('a', 'b')).toEqual(['a', 'b']);
  });
});

describe('getDismatchedPairKeys', () => {
  it('is empty for a fresh wardrobe with no ratings at all', async () => {
    const db = await freshDb();
    expect(await getDismatchedPairKeys(db)).toEqual(new Set());
  });

  it('includes only DISMATCH pairs, not MATCH ones', async () => {
    const db = await freshDb();
    const a = await insertItem(db, draft({ category: 'Top' }), 'aaa');
    const b = await insertItem(db, draft({ category: 'Pants' }), 'bbb');
    const c = await insertItem(db, draft({ category: 'Shoes' }), 'ccc');

    await setVerdict(db, a.id, b.id, 'MATCH');
    await setVerdict(db, a.id, c.id, 'DISMATCH');

    expect(await getDismatchedPairKeys(db)).toEqual(new Set(['aaa|ccc']));
    // A rated (but not dismatched) pair still counts as "rated" elsewhere —
    // the two sets answer different questions.
    expect(await listRatedPairKeys(db)).toEqual(new Set(['aaa|bbb', 'aaa|ccc']));
  });
});

describe('listItemsWornOn / logOutfitWorn', () => {
  it('reports nothing worn on a date with no logs', async () => {
    const db = await freshDb();
    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set());
  });

  it('records which items were worn on a date, and credits their wearCount', async () => {
    const db = await freshDb();
    const top = await insertItem(db, draft({ category: 'Top' }), 'top1');
    const bottom = await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await logOutfitWorn(db, [top.id, bottom.id], '2026-08-20', 'log1', '2026-08-20T08:00:00Z');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1', 'bottom1']));
    expect(await listItemsWornOn(db, '2026-08-21')).toEqual(new Set());

    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(1);
  });

  it('unions items across multiple outfits logged the same day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1');

    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1');
    await logOutfitWorn(db, ['bottom1', 'shoes1'], '2026-08-20', 'log2');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(
      new Set(['top1', 'bottom1', 'shoes1']),
    );
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(2);
  });

  it('rolls back the whole write if any part of it fails', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    // 'missing' has no row, so its wearCount UPDATE affects zero rows but does
    // not itself throw — the log insert is what should still land. This test
    // instead forces a failure by reusing an id, which the PRIMARY KEY rejects.
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'dup-log');
    await expect(logOutfitWorn(db, ['top1'], '2026-08-21', 'dup-log')).rejects.toThrow();

    // The failed second call must not have logged 2026-08-21 or double-counted
    // the wear it started to record.
    expect(await listItemsWornOn(db, '2026-08-21')).toEqual(new Set());
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });
});

describe('removeOutfitLogs', () => {
  it('scrubs the logged outfit and decrements wearCount for each item', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1');

    await removeOutfitLogs(db, '2026-08-20');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set());
    expect((await getItem(db, 'top1'))?.wearCount).toBe(0);
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(0);
  });

  it('decrements once per occurrence when an item appears in multiple logs that day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await logOutfitWorn(db, ['bottom1'], '2026-08-20', 'log1');
    await logOutfitWorn(db, ['bottom1'], '2026-08-20', 'log2');
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(2);

    await removeOutfitLogs(db, '2026-08-20');

    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(0);
  });

  it('never drops wearCount below zero', async () => {
    const db = await freshDb();
    const top = await insertItem(db, draft({ category: 'Top' }), 'top1');
    expect(top.wearCount).toBe(0);

    // Nothing logged for this date -- a no-op, not a negative wearCount.
    await removeOutfitLogs(db, '2026-08-20');

    expect((await getItem(db, 'top1'))?.wearCount).toBe(0);
  });

  it('leaves other dates and their wearCount untouched', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await logOutfitWorn(db, ['top1'], '2026-08-19', 'log-before');
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'log-target');

    await removeOutfitLogs(db, '2026-08-20');

    expect(await listItemsWornOn(db, '2026-08-19')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });
});

describe('replaceOutfitLog', () => {
  it('replaces a previously-logged outfit rather than stacking a second one', async () => {
    // Reported bug: LogOutfitScreen's "Edit outfit" called logOutfitWorn
    // again on save, which -- correctly, per logOutfitWorn's own "unions
    // multiple outfits logged the same day" contract -- added a *second* log
    // row on top of the first instead of replacing it, double-crediting
    // wearCount for every re-picked item. replaceOutfitLog is what the
    // "edit a single day's outfit" UI should call instead.
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await insertItem(db, draft({ category: 'Sweater' }), 'top2');
    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1');

    await replaceOutfitLog(db, ['top2', 'bottom1'], '2026-08-20', 'log2');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top2', 'bottom1']));
    // top1 was dropped by the edit -- its earlier credit is scrubbed, not left dangling.
    expect((await getItem(db, 'top1'))?.wearCount).toBe(0);
    // bottom1 was re-picked -- exactly one credit, not two.
    expect((await getItem(db, 'bottom1'))?.wearCount).toBe(1);
    expect((await getItem(db, 'top2'))?.wearCount).toBe(1);
  });

  it('behaves like a plain log when nothing was previously logged that day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await replaceOutfitLog(db, ['top1'], '2026-08-20', 'log1');

    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(1);
  });

  it('rolls back the whole replace if the insert half fails', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    // 'dup-log' is logged on a *different* date, so replaceOutfitLog's own
    // clear (scoped to 2026-08-20) never touches it -- it survives to make
    // the insert's id collide once replaceOutfitLog tries to reuse it below.
    await logOutfitWorn(db, ['top1'], '2026-08-19', 'dup-log');
    await logOutfitWorn(db, ['top1'], '2026-08-20', 'log-original');

    await expect(replaceOutfitLog(db, ['top1'], '2026-08-20', 'dup-log')).rejects.toThrow();

    // The clear must not have landed without its paired insert -- the
    // original 2026-08-20 log and its wearCount credit must still stand.
    expect(await listItemsWornOn(db, '2026-08-20')).toEqual(new Set(['top1']));
    expect((await getItem(db, 'top1'))?.wearCount).toBe(2);
  });
});

describe('listItemsByIds', () => {
  it('returns nothing for an empty id list', async () => {
    const db = await freshDb();
    expect(await listItemsByIds(db, [])).toEqual([]);
  });

  it('resolves the requested items and ignores an id that no longer exists', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1');

    const found = await listItemsByIds(db, ['top1', 'bottom1', 'missing']);
    expect(found.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
  });
});

describe('getLatestLoggedOutfit', () => {
  it('returns nothing for a date with no logs', async () => {
    const db = await freshDb();
    expect(await getLatestLoggedOutfit(db, '2026-08-20')).toEqual([]);
  });

  it('resolves the logged outfit to full items', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');
    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1', '2026-08-20T08:00:00Z');

    const outfit = await getLatestLoggedOutfit(db, '2026-08-20');
    expect(outfit.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
  });

  it('returns the most recently logged outfit when several were logged the same day', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-20', 'log1', '2026-08-20T08:00:00Z');
    await logOutfitWorn(db, ['top2', 'bottom1'], '2026-08-20', 'log2', '2026-08-20T18:00:00Z');

    const outfit = await getLatestLoggedOutfit(db, '2026-08-20');
    expect(outfit.map((i) => i.id).sort()).toEqual(['bottom1', 'top2']);
  });
});

describe('listLoggedOutfitsInRange', () => {
  it('returns an empty map when nothing was logged in range', async () => {
    const db = await freshDb();
    expect(await listLoggedOutfitsInRange(db, '2026-08-01', '2026-08-28')).toEqual(new Map());
  });

  it('maps each logged day to its items, and excludes days outside the range', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await logOutfitWorn(db, ['top1', 'bottom1'], '2026-08-10', 'log1');
    await logOutfitWorn(db, ['top1'], '2026-07-31', 'log-before'); // outside range
    await logOutfitWorn(db, ['bottom1'], '2026-08-29', 'log-after'); // outside range

    const result = await listLoggedOutfitsInRange(db, '2026-08-01', '2026-08-28');
    expect([...result.keys()]).toEqual(['2026-08-10']);
    expect(result.get('2026-08-10')?.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
  });

  it('resolves each day to its most recently logged outfit when logged more than once', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');

    await logOutfitWorn(db, ['top1'], '2026-08-10', 'log1', '2026-08-10T08:00:00Z');
    await logOutfitWorn(db, ['top2'], '2026-08-10', 'log2', '2026-08-10T18:00:00Z');

    const result = await listLoggedOutfitsInRange(db, '2026-08-01', '2026-08-28');
    expect(result.get('2026-08-10')?.map((i) => i.id)).toEqual(['top2']);
  });
});

describe('archiveItems / restoreItem / listArchivedItems / listExpiredArchivedItems', () => {
  it('excludes archived items from listItems and listItemsInCategories', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');

    await archiveItems(db, ['top1']);

    expect((await listItems(db)).map((i) => i.id)).toEqual(['top2']);
    expect((await listItemsInCategories(db, ['Top'])).map((i) => i.id)).toEqual(['top2']);
  });

  it('still resolves an archived item by id, since getItem is a direct lookup', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await archiveItems(db, ['top1']);

    expect((await getItem(db, 'top1'))?.id).toBe('top1');
  });

  it('archives a batch in one call, stamping every id with the same timestamp', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await archiveItems(db, ['top1', 'bottom1'], '2026-08-01T00:00:00.000Z');

    const archived = await listArchivedItems(db);
    expect(archived.map((i) => i.id).sort()).toEqual(['bottom1', 'top1']);
    expect(archived.every((i) => i.archivedAt === '2026-08-01T00:00:00.000Z')).toBe(true);
  });

  it('does nothing for an empty id list', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await archiveItems(db, []);

    expect(await listArchivedItems(db)).toEqual([]);
  });

  it('restores an archived item back into the ordinary listings', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await archiveItems(db, ['top1']);

    await restoreItem(db, 'top1');

    expect((await listItems(db)).map((i) => i.id)).toEqual(['top1']);
    expect(await listArchivedItems(db)).toEqual([]);
  });

  it('lists only items archived at or before the cutoff, oldest first', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'old');
    await insertItem(db, draft({ category: 'Top' }), 'boundary');
    await insertItem(db, draft({ category: 'Top' }), 'recent');
    await archiveItems(db, ['old'], '2026-06-01T00:00:00.000Z');
    await archiveItems(db, ['boundary'], '2026-07-01T00:00:00.000Z');
    await archiveItems(db, ['recent'], '2026-08-01T00:00:00.000Z');

    const expired = await listExpiredArchivedItems(db, '2026-07-01T00:00:00.000Z');

    expect(expired.map((i) => i.id)).toEqual(['old', 'boundary']);
  });
});

describe('setItemFlags', () => {
  it('sets isSecondHand true for a whole batch in one call', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await setItemFlags(db, ['top1', 'bottom1'], { isSecondHand: true });

    expect((await getItem(db, 'top1'))?.isSecondHand).toBe(true);
    expect((await getItem(db, 'bottom1'))?.isSecondHand).toBe(true);
  });

  it('sets isWorkAppropriate true for a whole batch in one call', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1');

    await setItemFlags(db, ['top1', 'bottom1'], { isWorkAppropriate: true });

    expect((await getItem(db, 'top1'))?.isWorkAppropriate).toBe(true);
    expect((await getItem(db, 'bottom1'))?.isWorkAppropriate).toBe(true);
  });

  it('sets both flags at once when both are given', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await setItemFlags(db, ['top1'], { isSecondHand: true, isWorkAppropriate: true });

    const item = await getItem(db, 'top1');
    expect(item?.isSecondHand).toBe(true);
    expect(item?.isWorkAppropriate).toBe(true);
  });

  it('leaves items outside the id list untouched', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');
    await insertItem(db, draft({ category: 'Top' }), 'top2');

    await setItemFlags(db, ['top1'], { isWorkAppropriate: true });

    expect((await getItem(db, 'top2'))?.isWorkAppropriate).toBe(false);
  });

  it('does nothing for an empty id list', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Top' }), 'top1');

    await expect(setItemFlags(db, [], { isSecondHand: true })).resolves.toBeUndefined();

    expect((await getItem(db, 'top1'))?.isSecondHand).toBe(false);
  });
});

describe('recentWearDays', () => {
  it('maps each item to days since its most recent log within the window', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-25', 'log-1', '2026-08-25T09:00:00.000Z');
    await logOutfitWorn(db, ['item-b'], '2026-08-29', 'log-2', '2026-08-29T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.get('item-a')).toBe(6);
    expect(result.get('item-b')).toBe(2);
  });

  it('keeps the smallest days-ago when an item appears in multiple logs', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-20', 'log-1', '2026-08-20T09:00:00.000Z');
    await logOutfitWorn(db, ['item-a'], '2026-08-29', 'log-2', '2026-08-29T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.get('item-a')).toBe(2);
  });

  it('excludes items worn outside the window', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-old'], '2026-07-01', 'log-1', '2026-07-01T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31', 30);

    expect(result.has('item-old')).toBe(false);
  });

  it('returns an empty map when nothing has been logged', async () => {
    const db = await freshDb();
    const result = await recentWearDays(db, '2026-08-31');
    expect(result.size).toBe(0);
  });

  it('throws when today is malformed', async () => {
    const db = await freshDb();
    await expect(recentWearDays(db, 'not-a-date')).rejects.toThrow('Invalid recent-wear query');
    await expect(recentWearDays(db, '2026-13-01')).rejects.toThrow('Invalid recent-wear query');
  });

  it('throws when windowDays is negative or non-finite', async () => {
    const db = await freshDb();
    await expect(recentWearDays(db, '2026-08-31', -1)).rejects.toThrow('Invalid recent-wear query');
    await expect(recentWearDays(db, '2026-08-31', NaN)).rejects.toThrow('Invalid recent-wear query');
    await expect(recentWearDays(db, '2026-08-31', Infinity)).rejects.toThrow('Invalid recent-wear query');
  });

  it('skips rows with future dates', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-25', 'log-past', '2026-08-25T09:00:00.000Z');
    // Manually insert a future-dated row
    await db.runAsync(
      'INSERT INTO Outfit_Logs (id, date, itemIds, collageImageUri, createdAt) VALUES (?, ?, ?, ?, ?)',
      ['log-future', '2026-09-01', '["item-c"]', '', '2026-08-31T09:00:00.000Z'],
    );

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.has('item-c')).toBe(false);
    expect(result.get('item-a')).toBe(6);
  });
});
