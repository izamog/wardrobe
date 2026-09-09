/**
 * @jest-environment node
 *
 * v5 onward, plus the schema/constraint tests that aren't tied to any one
 * migration. See migrations.test.ts for the fresh-install path and v1 -> v4.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, runMigrations } from '../migrations';
import { ALL_CATEGORIES } from '../../utils/categories';
import { adapt, freshDb, addItem } from '../migrationTestHelpers';

describe('v11 -> v12: renaming the Bottom category to Pants', () => {
  function v11Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 11)) db.exec(migration);
    db.exec('PRAGMA user_version = 11;');
    return db;
  }

  it('accepts Bottom, not Pants, before the migration runs', () => {
    const db = v11Db();
    expect(() => addItem(db, 'ok', 'Bottom')).not.toThrow();
    expect(() => addItem(db, 'bad', 'Pants')).toThrow(/CHECK constraint failed/);
  });

  it('rewrites an existing Bottom row to Pants', async () => {
    const db = v11Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('aaa', '', 'Bottom', 'then');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT category AS c FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      c: 'Pants',
    });
  });

  it('accepts every current category afterwards, including Pants, and no longer accepts Bottom', async () => {
    const db = v11Db();
    await runMigrations(adapt(db));

    for (const [i, category] of ALL_CATEGORIES.entries()) {
      expect(() => addItem(db, `ok-${i}`, category)).not.toThrow();
    }
    expect(() => addItem(db, 'bad', 'Bottom')).toThrow(/CHECK constraint failed/);
  });

  it('rewrites a Bottom row so its Pants-vocabulary length is still valid, unchanged', async () => {
    const db = v11Db();
    db.prepare(
      'INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)',
    ).run('aaa', '', 'Bottom', 'Cropped', 'then');

    await runMigrations(adapt(db));

    expect(
      db.prepare('SELECT category AS c, length AS l FROM ClothingItems WHERE id=?').get('aaa'),
    ).toEqual({ c: 'Pants', l: 'Cropped' });
  });

  it('keeps every verdict across this rebuild too', async () => {
    const db = v11Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('aaa', '', 'Top', 'then');
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('bbb', '', 'Bottom', 'then');
    db.prepare('INSERT INTO Item_Compatibility VALUES (?,?,?,?,?)')
      .run('p1', 'aaa', 'bbb', 'MATCH', '2026-01-01');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM Item_Compatibility').get()).toEqual({ n: 1 });
  });
});

describe('v13 -> v14: adding purchasedAt', () => {
  function v13Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 13)) db.exec(migration);
    db.exec('PRAGMA user_version = 13;');
    return db;
  }

  it('defaults existing rows to an empty string', async () => {
    const db = v13Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('aaa', '', 'Top', 'then');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT purchasedAt AS p FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      p: '',
    });
  });

  it('accepts any free text, unlike the CHECK-constrained columns', async () => {
    const db = v13Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, purchasedAt, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Top', 'a few years ago', 'then'),
    ).not.toThrow();
  });
});

describe('v15 -> v16: enforcing at most two materials as a CHECK', () => {
  function v15Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 15)) db.exec(migration);
    db.exec('PRAGMA user_version = 15;');
    return db;
  }

  it('truncates an existing row with more than two materials to the first two', async () => {
    const db = v15Db();
    db.prepare(
      'INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)',
    ).run('aaa', '', 'Top', '["cotton","wool","silk"]', 'then');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT materials AS m FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      m: '["cotton","wool"]',
    });
  });

  it('resets an unreadable materials value to an empty array rather than failing the migration', async () => {
    const db = v15Db();
    db.prepare(
      'INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)',
    ).run('aaa', '', 'Top', 'not json', 'then');
    db.prepare(
      'INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)',
    ).run('bbb', '', 'Top', '{"a":1}', 'then');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT materials AS m FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      m: '[]',
    });
    expect(db.prepare('SELECT materials AS m FROM ClothingItems WHERE id=?').get('bbb')).toEqual({
      m: '[]',
    });
  });

  it('leaves a row with two or fewer materials unchanged', async () => {
    const db = v15Db();
    db.prepare(
      'INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)',
    ).run('aaa', '', 'Top', '["cotton"]', 'then');

    await runMigrations(adapt(db));

    expect(db.prepare('SELECT materials AS m FROM ClothingItems WHERE id=?').get('aaa')).toEqual({
      m: '["cotton"]',
    });
  });

  it('rejects a direct insert of more than two materials once migrated — the schema itself enforces the limit, not just encodeMaterials', async () => {
    const db = v15Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Top', '["cotton","wool","silk"]', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects materials that are valid JSON but not an array', async () => {
    const db = v15Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Top', '{"cotton":true}', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects materials that are not valid JSON at all', async () => {
    const db = v15Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Top', 'cotton', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('accepts exactly two materials and an empty array', async () => {
    const db = v15Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Top', '["cotton","wool"]', 'then'),
    ).not.toThrow();
    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, materials, createdAt) VALUES (?,?,?,?,?)')
        .run('bbb', '', 'Top', '[]', 'then'),
    ).not.toThrow();
  });
});

describe('v17 -> v18: thickness, denier, backless', () => {
  function v17Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 17)) db.exec(migration);
    db.exec('PRAGMA user_version = 17;');
    return db;
  }

  it('has none of the three columns before the migration runs', () => {
    const db = v17Db();
    expect(() => db.prepare('SELECT thickness FROM ClothingItems').all()).toThrow();
    expect(() => db.prepare('SELECT denier FROM ClothingItems').all()).toThrow();
    expect(() => db.prepare('SELECT backless FROM ClothingItems').all()).toThrow();
  });

  it('defaults existing rows to Regular thickness, denier 0, backless false', async () => {
    const db = v17Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('old', '', 'Top', 'then');

    await runMigrations(adapt(db));

    expect(
      db.prepare('SELECT thickness, denier, backless FROM ClothingItems WHERE id = ?').get('old'),
    ).toEqual({ thickness: 'Regular', denier: 0, backless: 0 });
  });

  it('accepts every thickness and rejects anything else', async () => {
    const db = v17Db();
    await runMigrations(adapt(db));

    const insert = (id: string, thickness: string) =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, thickness, createdAt) VALUES (?,?,?,?,?)')
        .run(id, '', 'Top', thickness, 't');

    for (const thickness of ['Mesh', 'Light', 'Regular', 'Thick', 'Heavy']) {
      expect(() => insert(`th-${thickness}`, thickness)).not.toThrow();
    }
    expect(() => insert('bad', 'Medium')).toThrow(/CHECK constraint failed/);
  });

  it('accepts 0 or 5-270 for denier and rejects everything else', async () => {
    const db = v17Db();
    await runMigrations(adapt(db));

    const insert = (id: string, denier: number) =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, denier, createdAt) VALUES (?,?,?,?,?)')
        .run(id, '', 'Tights', denier, 't');

    for (const denier of [0, 5, 40, 270]) {
      expect(() => insert(`d-${denier}`, denier)).not.toThrow();
    }
    expect(() => insert('too-low', 4)).toThrow(/CHECK constraint failed/);
    expect(() => insert('too-high', 271)).toThrow(/CHECK constraint failed/);
  });

  it('accepts 0 or 1 for backless and rejects anything else', async () => {
    const db = v17Db();
    await runMigrations(adapt(db));

    const insert = (id: string, backless: number) =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, backless, createdAt) VALUES (?,?,?,?,?)')
        .run(id, '', 'Top', backless, 't');

    expect(() => insert('a', 0)).not.toThrow();
    expect(() => insert('b', 1)).not.toThrow();
    expect(() => insert('c', 2)).toThrow(/CHECK constraint failed/);
  });
});

describe('v18 -> v19: a Leggings vocabulary for length', () => {
  function v18Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 18)) db.exec(migration);
    db.exec('PRAGMA user_version = 18;');
    return db;
  }

  it('rejects a Leggings length before the migration runs, the same as any other non-Pants/Skirt category', () => {
    const db = v18Db();
    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Leggings', 'Short', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('accepts every Leggings length and rejects anything else, once migrated', async () => {
    const db = v18Db();
    await runMigrations(adapt(db));

    const insert = (id: string, length: string) =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run(id, '', 'Leggings', length, 't');

    for (const length of ['', 'Short', 'Knee-length', 'Capri', 'Long']) {
      expect(() => insert(`ll-${length || 'blank'}`, length)).not.toThrow();
    }
    expect(() => insert('bad', 'Midi')).toThrow(/CHECK constraint failed/);
  });

  it('still rejects a Leggings length on a Pants or Skirt item, and vice versa', async () => {
    const db = v18Db();
    await runMigrations(adapt(db));

    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run('aaa', '', 'Pants', 'Knee-length', 'then'),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare('INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)')
        .run('bbb', '', 'Skirt', 'Cropped', 'then'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('keeps every verdict across this migration too', async () => {
    const db = v18Db();
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

