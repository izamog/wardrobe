/**
 * @jest-environment node
 *
 * runMigrations() takes a structural interface rather than expo-sqlite's
 * concrete type, so these tests drive the real migration SQL and the real
 * version-stepping logic against node:sqlite. Only the driver differs from
 * what the app runs.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, runMigrations, type MigratableDatabase } from '../migrations';
import { ALL_CATEGORIES } from '../../utils/categories';

/** Presents a node:sqlite database as the interface runMigrations expects. */
function adapt(db: DatabaseSync): MigratableDatabase {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      return (db.prepare(sql).get() ?? null) as T | null;
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
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

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

const userVersion = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const addItem = (db: DatabaseSync, id: string, category = 'Top') =>
  db
    .prepare('INSERT INTO ClothingItems (id, imageUri, category, createdAt) VALUES (?, ?, ?, ?)')
    .run(id, 'file://x', category, '2026-01-01T00:00:00Z');

describe('runMigrations', () => {
  it('brings a fresh database to the current version', async () => {
    const db = freshDb();
    await runMigrations(adapt(db));
    expect(userVersion(db)).toBe(MIGRATIONS.length);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const db = freshDb();
    await runMigrations(adapt(db));
    addItem(db, 'keep-me');
    await runMigrations(adapt(db));
    expect(userVersion(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ClothingItems').get()).toEqual({ n: 1 });
  });

  it('upgrades a pre-versioning database left by the first Phase 1 build', async () => {
    const db = freshDb();
    // The original schema: no CHECKs, REAL cost, redundant pair index.
    db.exec(`
      CREATE TABLE ClothingItems (id TEXT PRIMARY KEY NOT NULL, imageUri TEXT NOT NULL,
        category TEXT NOT NULL, cost REAL DEFAULT 0.00, createdAt TEXT NOT NULL);
      CREATE TABLE Item_Compatibility (id TEXT PRIMARY KEY NOT NULL, item_a_id TEXT NOT NULL,
        item_b_id TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE Outfit_Logs (id TEXT PRIMARY KEY NOT NULL, date TEXT NOT NULL,
        itemIds TEXT NOT NULL, collageImageUri TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE INDEX idx_compat_pair ON Item_Compatibility(item_a_id, item_b_id);
    `);
    expect(userVersion(db)).toBe(0);

    await runMigrations(adapt(db));

    expect(userVersion(db)).toBe(MIGRATIONS.length);
    const cols = db.prepare('PRAGMA table_info(ClothingItems)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('costMinorUnits');
    expect(cols.map((c) => c.name)).not.toContain('cost');
  });

  it('refuses to run against a database from a newer build', async () => {
    const db = freshDb();
    await runMigrations(adapt(db));
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5};`);
    await expect(runMigrations(adapt(db))).rejects.toThrow(/newer than this build supports/);
  });
});

describe('schema constraints', () => {
  let db: DatabaseSync;
  beforeEach(async () => {
    db = freshDb();
    await runMigrations(adapt(db));
  });

  it('accepts every category the app offers and rejects anything else', () => {
    // Guards against the CHECK constraint and the Category union drifting apart.
    for (const [i, category] of ALL_CATEGORIES.entries()) {
      expect(() => addItem(db, `ok-${i}`, category)).not.toThrow();
    }
    expect(() => addItem(db, 'bad', 'Spaceship')).toThrow(/CHECK constraint failed/);
  });

  it('allows only Gold, Silver and None hardware', () => {
    const insert = (id: string, hw: string) =>
      db
        .prepare(
          'INSERT INTO ClothingItems (id, imageUri, category, hardwareColor, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, 'file://x', 'Belt', hw, 't');
    for (const hw of ['Gold', 'Silver', 'None']) {
      expect(() => insert(`hw-${hw}`, hw)).not.toThrow();
    }
    expect(() => insert('hw-brass', 'Brass')).toThrow(/CHECK constraint failed/);
  });

  it('keeps warmth and wind within 0-10', () => {
    const insert = (id: string, warmth: number) =>
      db
        .prepare(
          'INSERT INTO ClothingItems (id, imageUri, category, inferredWarmth, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, 'file://x', 'Top', warmth, 't');
    expect(() => insert('w0', 0)).not.toThrow();
    expect(() => insert('w10', 10)).not.toThrow();
    expect(() => insert('w11', 11)).toThrow(/CHECK constraint failed/);
    expect(() => insert('wneg', -1)).toThrow(/CHECK constraint failed/);
  });

  it('stores cost as whole minor units and rejects negatives', () => {
    const insert = (id: string, cost: number) =>
      db
        .prepare(
          'INSERT INTO ClothingItems (id, imageUri, category, costMinorUnits, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, 'file://x', 'Top', cost, 't');
    insert('c1', 1250);
    expect(db.prepare('SELECT costMinorUnits AS c FROM ClothingItems WHERE id=?').get('c1')).toEqual({
      c: 1250,
    });
    expect(() => insert('c2', -1)).toThrow(/CHECK constraint failed/);
  });

  it('rejects outfit dates that are not YYYY-MM-DD', () => {
    const insert = (id: string, date: string) =>
      db
        .prepare('INSERT INTO Outfit_Logs (id, date, collageImageUri, createdAt) VALUES (?,?,?,?)')
        .run(id, date, 'file://c', 't');
    expect(() => insert('d1', '2026-08-19')).not.toThrow();
    expect(() => insert('d2', '19/08/2026')).toThrow(/CHECK constraint failed/);
  });
});

describe('compatibility pairing rules', () => {
  let db: DatabaseSync;
  const pair = (id: string, a: string, b: string, status = 'MATCH') =>
    db
      .prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run(id, a, b, status, '2026-01-01');

  beforeEach(async () => {
    db = freshDb();
    await runMigrations(adapt(db));
    addItem(db, 'aaa');
    addItem(db, 'bbb', 'Bottom');
  });

  it('stores a pair given in canonical order', () => {
    expect(() => pair('p1', 'aaa', 'bbb')).not.toThrow();
  });

  it('rejects the reversed order, so one pair cannot hold two verdicts', () => {
    pair('p1', 'aaa', 'bbb', 'MATCH');
    expect(() => pair('p2', 'bbb', 'aaa', 'DISMATCH')).toThrow(/CHECK constraint failed/);
  });

  it('rejects an item paired with itself', () => {
    expect(() => pair('p1', 'aaa', 'aaa')).toThrow(/CHECK constraint failed/);
  });

  it('rejects a duplicate pair', () => {
    pair('p1', 'aaa', 'bbb');
    expect(() => pair('p2', 'aaa', 'bbb', 'DISMATCH')).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a status outside MATCH and DISMATCH', () => {
    expect(() => pair('p1', 'aaa', 'bbb', 'MAYBE')).toThrow(/CHECK constraint failed/);
  });

  it('rejects a pair referencing an item that does not exist', () => {
    expect(() => pair('p1', 'aaa', 'zzz')).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('deletes an item\'s rules along with the item', () => {
    pair('p1', 'aaa', 'bbb');
    db.prepare('DELETE FROM ClothingItems WHERE id = ?').run('aaa');
    expect(db.prepare('SELECT COUNT(*) AS n FROM Item_Compatibility').get()).toEqual({ n: 0 });
  });
});

describe('indexes', () => {
  let db: DatabaseSync;
  beforeEach(async () => {
    db = freshDb();
    await runMigrations(adapt(db));
  });

  it('indexes lookups from either side of a pair', () => {
    // Canonical ordering means "rules involving X" must match either column;
    // an unindexed side turns the app's central query into a full scan.
    for (const column of ['item_a_id', 'item_b_id']) {
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN SELECT * FROM Item_Compatibility WHERE ${column} = 'x'`)
        .all() as { detail: string }[];
      expect(plan.map((r) => r.detail).join(' ')).toMatch(/USING (COVERING )?INDEX/);
    }
  });

  it('carries no explicit index duplicating the UNIQUE pair constraint', () => {
    const explicit = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Item_Compatibility' AND sql IS NOT NULL")
      .all() as { name: string }[];
    expect(explicit.map((r) => r.name)).toEqual(['idx_compat_item_b']);
  });
});
