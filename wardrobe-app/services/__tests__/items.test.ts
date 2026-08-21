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
import {
  canonicalPair,
  clearCompatibility,
  deleteItem,
  getCompatibility,
  getDismatchedPairKeys,
  getItem,
  getLatestLoggedOutfit,
  getVerdictsFor,
  insertItem,
  listItems,
  listItemsByIds,
  listItemsInCategories,
  listItemsWornOn,
  listRatedPairKeys,
  logOutfitWorn,
  rowToItem,
  setCompatibility,
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
  primaryColor: '',
  secondaryColor: '',
  category: 'Top',
  brand: 'Unbranded',
  costMinorUnits: 0,
  isSecondHand: false,
  materials: [],
  hardwareColor: 'None',
  hasBeltLoops: false,
  sleeveLength: 'Short',
  length: '',
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
        materials: ['cotton', 'elastane'],
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
});

describe('rowToItem', () => {
  // The columns are TEXT/INTEGER, so booleans and materials need decoding —
  // a raw row cast to ClothingItem would be wrong about exactly these fields.
  it('decodes INTEGER booleans and JSON materials', () => {
    const item = rowToItem({
      id: 'a',
      imagePath: '',
      originalImagePath: '',
      primaryColor: 'Navy',
      secondaryColor: '',
      category: 'Top',
      brand: 'b',
      costMinorUnits: 0,
      isSecondHand: 1,
      materials: '["wool"]',
      hardwareColor: 'Gold',
      hasBeltLoops: 0,
      sleeveLength: 'Short',
      length: '',
      inferredWarmth: 0,
      inferredWind: 0,
      wearCount: 0,
      createdAt: 'now',
    });

    expect(item.isSecondHand).toBe(true);
    expect(item.hasBeltLoops).toBe(false);
    expect(item.materials).toEqual(['wool']);
  });

  it('falls back to an empty list rather than throwing on unreadable materials', () => {
    const base = {
      id: 'a',
      imagePath: '',
      originalImagePath: '',
      primaryColor: '',
      secondaryColor: '',
      category: 'Top',
      brand: 'b',
      costMinorUnits: 0,
      isSecondHand: 0,
      hardwareColor: 'None',
      hasBeltLoops: 0,
      sleeveLength: 'Short',
      length: '',
      inferredWarmth: 0,
      inferredWind: 0,
      wearCount: 0,
      createdAt: 'now',
    };
    expect(rowToItem({ ...base, materials: 'not json' }).materials).toEqual([]);
    expect(rowToItem({ ...base, materials: '{"a":1}' }).materials).toEqual([]);
    expect(rowToItem({ ...base, materials: '["ok", 7]' }).materials).toEqual(['ok']);
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

    await updateItem(db, 'id-1', { isSecondHand: true, materials: ['linen'] });

    const item = await getItem(db, 'id-1');
    expect(item?.isSecondHand).toBe(true);
    expect(item?.materials).toEqual(['linen']);
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
