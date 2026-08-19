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
import { SCALE_MAX } from '../../utils/format';

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

/** Inserts against the current schema, where the photo column is imagePath. */
const addItem = (db: DatabaseSync, id: string, category = 'Top') =>
  db
    .prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?, ?, ?, ?)')
    .run(id, '', category, '2026-01-01T00:00:00Z');

/**
 * Inserts against a schema older than v3, where the column is still imageUri.
 * Needed to seed the databases the upgrade tests then migrate.
 */
const addLegacyItem = (db: DatabaseSync, id: string, category = 'Top') =>
  db
    .prepare('INSERT INTO ClothingItems (id, imageUri, category, createdAt) VALUES (?, ?, ?, ?)')
    .run(id, '', category, '2026-01-01T00:00:00Z');

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

describe('v1 -> v2: widening the category constraint', () => {
  /** Builds a database at exactly v1, the schema before the new categories. */
  function v1Db(): DatabaseSync {
    const db = freshDb();
    db.exec(MIGRATIONS[0]);
    db.exec('PRAGMA user_version = 1;');
    return db;
  }

  const countOf = (db: DatabaseSync, table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it('keeps every verdict, which a naive table rebuild would cascade away', async () => {
    // The danger this migration is written around: with foreign keys on,
    // DROP TABLE on the parent fires ON DELETE CASCADE on the children, so
    // rebuilding ClothingItems in the obvious order deletes the entire
    // compatibility matrix without erroring.
    const db = v1Db();
    addLegacyItem(db, 'aaa', 'Top');
    addLegacyItem(db, 'bbb', 'Bottom');
    addLegacyItem(db, 'ccc', 'Shoes');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p2', 'bbb', 'ccc', 'DISMATCH', '2026-01-02');

    await runMigrations(adapt(db));

    expect(countOf(db, 'ClothingItems')).toBe(3);
    expect(db.prepare('SELECT * FROM Item_Compatibility ORDER BY id').all()).toEqual([
      { id: 'p1', item_a_id: 'aaa', item_b_id: 'bbb', status: 'MATCH', createdAt: '2026-01-01' },
      { id: 'p2', item_a_id: 'bbb', item_b_id: 'ccc', status: 'DISMATCH', createdAt: '2026-01-02' },
    ]);
  });

  it('carries every item column across the rebuild unchanged', async () => {
    const db = v1Db();
    db.prepare(
      `INSERT INTO ClothingItems (id, imageUri, category, brand, costMinorUnits, isSecondHand,
        materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('x', 'items/a.png', 'Bottom', 'Levis', 4599, 1, '["cotton"]', 'Silver', 1, 3, 2, 7, 'then');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT * FROM ClothingItems').get()).toEqual({
      id: 'x',
      imagePath: 'items/a.png',
      originalImagePath: 'items/a.png',
      category: 'Bottom',
      brand: 'Levis',
      costMinorUnits: 4599,
      isSecondHand: 1,
      materials: '["cotton"]',
      hardwareColor: 'Silver',
      hasBeltLoops: 1,
      inferredWarmth: 3,
      inferredWind: 2,
      wearCount: 7,
      createdAt: 'then',
    });
  });

  it('leaves Outfit_Logs alone', async () => {
    const db = v1Db();
    db.prepare('INSERT INTO Outfit_Logs (id, date, collageImageUri, createdAt) VALUES (?,?,?,?)')
      .run('log-1', '2026-08-19', 'file://c.png', 'then');

    await runMigrations(adapt(db));

    expect(countOf(db, 'Outfit_Logs')).toBe(1);
  });

  it('does not guess at generic categories while they are still valid', async () => {
    // v2 widens the constraint and rewrites nothing. 'Outerwear' is only
    // remapped later, by v4, which is the migration that removes it — see the
    // v3 -> v4 block below. Running the full chain here shows both steps.
    const db = v1Db();
    addLegacyItem(db, 'legacy-top', 'Top');
    addLegacyItem(db, 'legacy-outer', 'Outerwear');

    await runMigrations(adapt(db));

    expect(
      db.prepare('SELECT id, category FROM ClothingItems ORDER BY id').all(),
    ).toEqual([
      { id: 'legacy-outer', category: 'Jacket' },
      { id: 'legacy-top', category: 'Top' },
    ]);
  });

  it('accepts the new garment categories only after the migration runs', async () => {
    const db = v1Db();
    expect(() => addLegacyItem(db, 'early', 'Sweater')).toThrow(/CHECK constraint failed/);

    await runMigrations(adapt(db));

    expect(() => addItem(db, 'late', 'Sweater')).not.toThrow();
  });

  it('leaves no scaffolding tables behind', async () => {
    const db = v1Db();
    await runMigrations(adapt(db));

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).not.toContain('ClothingItems_new');
    expect(tables).not.toContain('Item_Compatibility_backup');
  });

  it('still cascades verdict deletion after the tables are rebuilt', async () => {
    // The foreign keys are re-declared by hand in the migration, so this is
    // not covered by the fresh-install cascade test alone.
    const db = v1Db();
    addLegacyItem(db, 'aaa', 'Top');
    addLegacyItem(db, 'bbb', 'Bottom');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');

    await runMigrations(adapt(db));
    db.prepare('DELETE FROM ClothingItems WHERE id = ?').run('aaa');

    expect(countOf(db, 'Item_Compatibility')).toBe(0);
  });
});

describe('v2 -> v3: photos on disk', () => {
  /** Builds a database at exactly v2, the schema before photos. */
  function v2Db(): DatabaseSync {
    const db = freshDb();
    db.exec(MIGRATIONS[0]);
    db.exec(MIGRATIONS[1]);
    db.exec('PRAGMA user_version = 2;');
    return db;
  }

  const columnsOf = (db: DatabaseSync) =>
    (db.prepare('PRAGMA table_info(ClothingItems)').all() as { name: string }[]).map((c) => c.name);

  it('renames imageUri to imagePath, keeping the values', async () => {
    const db = v2Db();
    db.prepare(
      'INSERT INTO ClothingItems (id, imageUri, category, createdAt) VALUES (?,?,?,?)',
    ).run('a', 'items/a.jpg', 'Top', 'then');

    await runMigrations(adapt(db));

    expect(columnsOf(db)).toContain('imagePath');
    expect(columnsOf(db)).not.toContain('imageUri');
    expect(db.prepare('SELECT imagePath FROM ClothingItems WHERE id = ?').get('a')).toEqual({
      imagePath: 'items/a.jpg',
    });
  });

  it('adds originalImagePath, defaulting to empty for photoless rows', async () => {
    const db = v2Db();
    addLegacyItem(db, 'no-photo');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT originalImagePath AS o FROM ClothingItems WHERE id=?').get('no-photo'))
      .toEqual({ o: '' });
  });

  it('backfills the original from the existing photo, so every photo has a source', async () => {
    const db = v2Db();
    db.prepare(
      'INSERT INTO ClothingItems (id, imageUri, category, createdAt) VALUES (?,?,?,?)',
    ).run('a', 'items/a.jpg', 'Top', 'then');

    await runMigrations(adapt(db));

    expect(
      db.prepare('SELECT originalImagePath AS o FROM ClothingItems WHERE id=?').get('a'),
    ).toEqual({ o: 'items/a.jpg' });
  });

  it('leaves verdicts untouched — this migration alters in place, it does not rebuild', async () => {
    const db = v2Db();
    addLegacyItem(db, 'aaa');
    addLegacyItem(db, 'bbb', 'Bottom');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM Item_Compatibility').get()).toEqual({ n: 1 });
  });
});

describe('v3 -> v4: settling the garment vocabulary', () => {
  /** Builds a database at exactly v3, before the vocabulary changed. */
  function v3Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 3)) db.exec(migration);
    db.exec('PRAGMA user_version = 3;');
    return db;
  }

  const addV3Item = (db: DatabaseSync, id: string, category: string) =>
    db
      .prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run(id, '', category, 'then');

  const categoryOf = (db: DatabaseSync, id: string) =>
    (db.prepare('SELECT category AS c FROM ClothingItems WHERE id=?').get(id) as { c: string }).c;

  it('folds Tank into Top, which inherits its layering rules', async () => {
    const db = v3Db();
    addV3Item(db, 'was-tank', 'Tank');

    await runMigrations(adapt(db));

    expect(categoryOf(db, 'was-tank')).toBe('Top');
  });

  it('leaves rows that were already Top alone, so the merge is not lossy', async () => {
    const db = v3Db();
    addV3Item(db, 'was-top', 'Top');

    await runMigrations(adapt(db));

    expect(categoryOf(db, 'was-top')).toBe('Top');
  });

  it('remaps the removed generic Outerwear to Jacket rather than dropping the row', async () => {
    const db = v3Db();
    addV3Item(db, 'was-outer', 'Outerwear');

    await runMigrations(adapt(db));

    expect(categoryOf(db, 'was-outer')).toBe('Jacket');
  });

  it('rejects the retired categories afterwards', async () => {
    const db = v3Db();
    await runMigrations(adapt(db));

    expect(() => addItem(db, 'tank', 'Tank')).toThrow(/CHECK constraint failed/);
    expect(() => addItem(db, 'outer', 'Outerwear')).toThrow(/CHECK constraint failed/);
  });

  it('accepts Cardigan only after the migration runs', async () => {
    const db = v3Db();
    expect(() => addV3Item(db, 'early', 'Cardigan')).toThrow(/CHECK constraint failed/);

    await runMigrations(adapt(db));

    expect(() => addItem(db, 'late', 'Cardigan')).not.toThrow();
  });

  it('keeps every verdict across this rebuild too', async () => {
    const db = v3Db();
    addV3Item(db, 'aaa', 'Tank');
    addV3Item(db, 'bbb', 'Bottom');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM Item_Compatibility').get()).toEqual({ n: 1 });
  });

  it('carries the photo columns across the rebuild', async () => {
    const db = v3Db();
    db.prepare(
      `INSERT INTO ClothingItems (id, imagePath, originalImagePath, category, createdAt)
       VALUES (?,?,?,?,?)`,
    ).run('x', 'items/x-1.jpg', 'items/x-0.jpg', 'Tank', 'then');

    await runMigrations(adapt(db));

    expect(
      db.prepare('SELECT imagePath AS i, originalImagePath AS o FROM ClothingItems').get(),
    ).toEqual({ i: 'items/x-1.jpg', o: 'items/x-0.jpg' });
  });

  it('leaves no scaffolding tables behind', async () => {
    const db = v3Db();
    await runMigrations(adapt(db));

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).not.toContain('ClothingItems_new');
    expect(tables).not.toContain('Item_Compatibility_backup');
  });
});

describe('v5 -> v6: warmth and windproof widened back to 0-10', () => {
  function v5Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 5)) db.exec(migration);
    db.exec('PRAGMA user_version = 5;');
    return db;
  }

  it('accepts the full scale afterwards, and nothing beyond it', async () => {
    const db = v5Db();
    await runMigrations(adapt(db));

    const insert = (id: string, warmth: number) =>
      db
        .prepare(
          `INSERT INTO ClothingItems (id, imagePath, category, inferredWarmth, createdAt)
           VALUES (?,?,?,?,?)`,
        )
        .run(id, '', 'Top', warmth, 'then');

    expect(() => insert('at-max', SCALE_MAX)).not.toThrow();
    expect(() => insert('over', SCALE_MAX + 1)).toThrow(/CHECK constraint failed/);
  });

  it('keeps rows and verdicts across the rebuild', async () => {
    const db = v5Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('aaa', 'items/a.jpg', 'Top', 'then');
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('bbb', '', 'Bottom', 'then');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM ClothingItems').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM Item_Compatibility').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT imagePath AS p FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      p: 'items/a.jpg',
    });
  });
});

describe('v4 -> v5: warmth and windproof rescaled to 0-5', () => {
  /** Builds a database at exactly v4, while the columns still allowed 0-10. */
  function v4Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 4)) db.exec(migration);
    db.exec('PRAGMA user_version = 4;');
    return db;
  }

  const addV4Item = (db: DatabaseSync, id: string, warmth: number, wind: number) =>
    db
      .prepare(
        `INSERT INTO ClothingItems (id, imagePath, category, inferredWarmth, inferredWind, createdAt)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(id, '', 'Top', warmth, wind, 'then');

  const scalesOf = (db: DatabaseSync, id: string) =>
    db.prepare('SELECT inferredWarmth AS warmth, inferredWind AS wind FROM ClothingItems WHERE id=?')
      .get(id);

  it('clamps values above its own ceiling', async () => {
    // 5 is v5's ceiling, not SCALE_MAX: v6 widens the column again, but the
    // clamp v5 applied on the way through is not undone.
    const db = v4Db();
    addV4Item(db, 'hot', 9, 10);

    await runMigrations(adapt(db));

    expect(scalesOf(db, 'hot')).toEqual({ warmth: 5, wind: 5 });
  });

  it('leaves values already on the new scale untouched', async () => {
    const db = v4Db();
    addV4Item(db, 'mild', 3, 0);

    await runMigrations(adapt(db));

    expect(scalesOf(db, 'mild')).toEqual({ warmth: 3, wind: 0 });
  });

  it('keeps every verdict across this rebuild too', async () => {
    const db = v4Db();
    addV4Item(db, 'aaa', 0, 0);
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('bbb', '', 'Bottom', 'then');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM Item_Compatibility').get()).toEqual({ n: 1 });
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
          'INSERT INTO ClothingItems (id, imagePath, category, hardwareColor, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, '', 'Belt', hw, 't');
    for (const hw of ['Gold', 'Silver', 'None']) {
      expect(() => insert(`hw-${hw}`, hw)).not.toThrow();
    }
    expect(() => insert('hw-brass', 'Brass')).toThrow(/CHECK constraint failed/);
  });

  it('keeps warmth and windproof within 0 and the top of the scale', () => {
    const insert = (id: string, column: string, value: number) =>
      db
        .prepare(
          `INSERT INTO ClothingItems (id, imagePath, category, ${column}, createdAt) VALUES (?,?,?,?,?)`,
        )
        .run(id, '', 'Top', value, 't');

    for (const column of ['inferredWarmth', 'inferredWind']) {
      // 0 is "not assessed", which is where every row starts.
      expect(() => insert(`${column}-0`, column, 0)).not.toThrow();
      expect(() => insert(`${column}-max`, column, SCALE_MAX)).not.toThrow();
      expect(() => insert(`${column}-over`, column, SCALE_MAX + 1)).toThrow(
        /CHECK constraint failed/,
      );
      expect(() => insert(`${column}-neg`, column, -1)).toThrow(/CHECK constraint failed/);
    }
  });

  it('stores cost as whole minor units and rejects negatives', () => {
    const insert = (id: string, cost: number) =>
      db
        .prepare(
          'INSERT INTO ClothingItems (id, imagePath, category, costMinorUnits, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, '', 'Top', cost, 't');
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
