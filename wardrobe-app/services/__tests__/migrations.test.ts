/**
 * @jest-environment node
 *
 * runMigrations() takes a structural interface rather than expo-sqlite's
 * concrete type, so these tests drive the real migration SQL and the real
 * version-stepping logic against node:sqlite. Only the driver differs from
 * what the app runs.
 *
 * Covers the fresh-install path and v1 -> v4. v5 onward is in
 * migrations-schema.test.ts, along with the schema/constraint tests that
 * don't belong to any one migration.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, runMigrations } from '../migrations';
import { adapt, freshDb, userVersion, addItem, addLegacyItem } from '../migrationTestHelpers';

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
      primaryColor: '',
      secondaryColor: '',
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
