/**
 * @jest-environment node
 *
 * v5 onward, plus the schema/constraint tests that aren't tied to any one
 * migration. See migrations.test.ts for the fresh-install path and v1 -> v4.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, runMigrations } from '../migrations';
import { ALL_CATEGORIES } from '../../utils/categories';
import { SCALE_MAX } from '../../utils/format';
import { adapt, freshDb, addItem } from '../migrationTestHelpers';

describe('v19 -> v20: Dress shares Skirt\'s length vocabulary', () => {
  function v19Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 19)) db.exec(migration);
    db.exec('PRAGMA user_version = 19;');
    return db;
  }

  it('rejects a Dress length before the migration runs, the same as any other non-Pants/Leggings/Skirt category', () => {
    const db = v19Db();
    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Dress', 'Midi', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('accepts every Skirt length on a Dress and rejects anything else, once migrated', async () => {
    const db = v19Db();
    await runMigrations(adapt(db));

    const insert = (id: string, length: string) =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run(id, '', 'Dress', length, 't');

    for (const length of ['', 'Mini', 'Knee-length', 'Midi', 'Maxi']) {
      expect(() => insert(`dl-${length || 'blank'}`, length)).not.toThrow();
    }
    expect(() => insert('bad', 'Short')).toThrow(/CHECK constraint failed/);
  });

  it('still rejects a Dress length on a Pants or Leggings item, and vice versa', async () => {
    const db = v19Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Pants', 'Midi', 'then'),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run('bbb', '', 'Leggings', 'Maxi', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('keeps every verdict across this migration too', async () => {
    const db = v19Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('aaa', '', 'Top', 'then');
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('bbb', '', 'Pants', 'then');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM Item_Compatibility').get()).toEqual({ n: 1 });
  });
});

describe('v20 -> v21: a work-appropriate flag', () => {
  function v20Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 20)) db.exec(migration);
    db.exec('PRAGMA user_version = 20;');
    return db;
  }

  it('defaults existing rows to not work appropriate', async () => {
    const db = v20Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('aaa', '', 'Top', 'then');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT isWorkAppropriate AS w FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      w: 0,
    });
  });

  it('accepts 0 or 1 and rejects anything else', async () => {
    const db = v20Db();
    await runMigrations(adapt(db));

    const insert = (id: string, value: number) =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, isWorkAppropriate, createdAt) VALUES (?,?,?,?,?)')
        .run(id, '', 'Top', value, 't');

    expect(() => insert('wa-0', 0)).not.toThrow();
    expect(() => insert('wa-1', 1)).not.toThrow();
    expect(() => insert('wa-bad', 2)).toThrow(/CHECK constraint failed/);
  });
});

describe('v21 -> v22: Shorts split out of Pants into its own category', () => {
  function v21Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 21)) db.exec(migration);
    db.exec('PRAGMA user_version = 21;');
    return db;
  }

  it('rejects a Shorts category before the migration runs', () => {
    const db = v21Db();
    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
        .run('aaa', '', 'Shorts', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('accepts Shorts once migrated, and ALL_CATEGORIES includes it', async () => {
    const db = v21Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
        .run('aaa', '', 'Shorts', 'then'),
    ).not.toThrow();
    expect(ALL_CATEGORIES).toContain('Shorts');
  });

  it('rejects a length on Shorts, the same as any other category with no length vocabulary', async () => {
    const db = v21Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Shorts', 'Short', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('auto-migrates existing Pants at Short length to the new Shorts category', async () => {
    const db = v21Db();
    db.prepare(
      "INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES ('aaa','', 'Pants', 'Short', 'then')",
    ).run();
    db.prepare(
      "INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES ('bbb','', 'Pants', 'Long', 'then')",
    ).run();

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT category AS c, length AS l FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      c: 'Shorts',
      l: '',
    });
    // A full-length pair of Pants is untouched by the remap.
    expect(db.prepare('SELECT category AS c, length AS l FROM ClothingItems WHERE id=?').get('bbb')).toEqual({
      c: 'Pants',
      l: 'Long',
    });
  });

  it('keeps every verdict across this migration too', async () => {
    const db = v21Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('aaa', '', 'Top', 'then');
    db.prepare("INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES ('bbb','', 'Pants', 'Short', 'then')")
      .run();
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

  it('allows only Gold, Silver, Brass, Black and None hardware', () => {
    const insert = (id: string, hw: string) =>
      db
        .prepare(
          'INSERT INTO ClothingItems (id, imagePath, category, hardwareColor, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, '', 'Belt', hw, 't');
    for (const hw of ['Gold', 'Silver', 'Brass', 'Black', 'None']) {
      expect(() => insert(`hw-${hw}`, hw)).not.toThrow();
    }
    expect(() => insert('hw-copper', 'Copper')).toThrow(/CHECK constraint failed/);
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
    addItem(db, 'bbb', 'Pants');
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
