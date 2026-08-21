/**
 * @jest-environment node
 *
 * Covers the DB orchestration (candidate fetching, worn-today exclusion,
 * cold-start safety) against real SQL over node:sqlite. The search algorithm
 * itself — including bottom selection — is covered without a database in
 * utils/__tests__/outfitGenerator.test.ts.
 */
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, type MigratableDatabase } from '../migrations';
import { insertItem, logOutfitWorn, setCompatibility, type ItemsDatabase, type NewClothingItem } from '../items';
import { generateClosestTodayOutfits, generateTodayOutfits } from '../outfitGenerator';

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

const TODAY = '2026-08-20';
const NO_CEILING = 1000;
const bounds = { warmthFloor: 0, warmthCeiling: NO_CEILING, windFloor: 0, today: TODAY };

describe('generateTodayOutfits', () => {
  it('returns nothing when there are no bottoms at all', async () => {
    const db = await freshDb();
    expect(await generateTodayOutfits(db, bounds)).toEqual([]);
  });

  it('generates an outfit from a cold-start wardrobe with zero rated pairs', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'T-Shirt' }), 'top1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1', '2026-08-01T00:00:00Z');

    const outfits = await generateTodayOutfits(db, bounds);

    expect(outfits).toHaveLength(1);
    expect(outfits[0].map((i) => i.id).sort()).toEqual(['bottom1', 'shoes1', 'top1']);
  });

  it('excludes a bottom already logged as worn today', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'worn-bottom', '2026-08-10T00:00:00Z');
    await insertItem(db, draft({ category: 'Pants' }), 'unworn-bottom', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'T-Shirt' }), 'top1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1', '2026-08-01T00:00:00Z');

    await logOutfitWorn(db, ['worn-bottom'], TODAY, 'log1');

    const outfits = await generateTodayOutfits(db, bounds);

    expect(outfits).toHaveLength(1);
    expect(outfits[0].some((i) => i.id === 'worn-bottom')).toBe(false);
    expect(outfits[0].some((i) => i.id === 'unworn-bottom')).toBe(true);
  });

  it('returns nothing when every bottom was worn today', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1', '2026-08-01T00:00:00Z');
    await logOutfitWorn(db, ['bottom1'], TODAY, 'log1');

    expect(await generateTodayOutfits(db, bounds)).toEqual([]);
  });

  it('a bottom worn on a different day is still eligible today', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'T-Shirt' }), 'top1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1', '2026-08-01T00:00:00Z');
    await logOutfitWorn(db, ['bottom1'], '2026-08-19', 'log1');

    const outfits = await generateTodayOutfits(db, bounds);

    expect(outfits[0].some((i) => i.id === 'bottom1')).toBe(true);
  });

  it('excludes a top explicitly DISMATCHed against the chosen bottom', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'T-Shirt' }), 'bad-top', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shirt' }), 'good-top', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1', '2026-08-01T00:00:00Z');
    await setCompatibility(db, 'bottom1', 'bad-top', 'DISMATCH', 'verdict1', '2026-08-01T00:00:00Z');

    const outfits = await generateTodayOutfits(db, bounds);

    expect(outfits).toHaveLength(1);
    const ids = outfits[0].map((i) => i.id);
    expect(ids).not.toContain('bad-top');
    expect(ids).toContain('good-top');
  });

  it('rejects an outfit whose weighted warmth exceeds the ceiling', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants', inferredWarmth: 8 }), 'bottom1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'T-Shirt', inferredWarmth: 8 }), 'top1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1', '2026-08-01T00:00:00Z');

    const outfits = await generateTodayOutfits(db, { ...bounds, warmthCeiling: 3 });

    expect(outfits).toEqual([]);
  });
});

describe('generateClosestTodayOutfits', () => {
  it('returns nothing when there are no bottoms at all', async () => {
    const db = await freshDb();
    expect(await generateClosestTodayOutfits(db, bounds)).toEqual([]);
  });

  it('ranks the closest outfit the wardrobe can build, even though it misses the target', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'bottom1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'T-Shirt', inferredWarmth: 1 }), 'cold-top', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Sweater', inferredWarmth: 4 }), 'warm-top', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1', '2026-08-01T00:00:00Z');

    const closest = await generateClosestTodayOutfits(db, { ...bounds, warmthFloor: 5 });

    expect(closest[0].items.map((i) => i.id)).toContain('warm-top');
    expect(closest[0].meetsTarget).toBe(false);
  });

  it('excludes a bottom already worn today, same as generateTodayOutfits', async () => {
    const db = await freshDb();
    await insertItem(db, draft({ category: 'Pants' }), 'worn-bottom', '2026-08-10T00:00:00Z');
    await insertItem(db, draft({ category: 'T-Shirt' }), 'top1', '2026-08-01T00:00:00Z');
    await insertItem(db, draft({ category: 'Shoes' }), 'shoes1', '2026-08-01T00:00:00Z');
    await logOutfitWorn(db, ['worn-bottom'], TODAY, 'log1');

    expect(await generateClosestTodayOutfits(db, bounds)).toEqual([]);
  });
});
