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

describe('v6 -> v7: garment colour', () => {
  function v6Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 6)) db.exec(migration);
    db.exec('PRAGMA user_version = 6;');
    return db;
  }

  const addColored = (db: DatabaseSync, id: string, primary: string, secondary: string) =>
    db
      .prepare(
        `INSERT INTO ClothingItems (id, imagePath, category, primaryColor, secondaryColor, createdAt)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(id, '', 'Top', primary, secondary, 'then');

  it('leaves existing rows with no colour recorded', async () => {
    const db = v6Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('old', 'items/a.jpg', 'Top', 'then');

    await runMigrations(adapt(db));

    expect(
      db.prepare('SELECT primaryColor AS p, secondaryColor AS s FROM ClothingItems').get(),
    ).toEqual({ p: '', s: '' });
  });

  it('accepts one colour, two colours, and none', async () => {
    const db = v6Db();
    await runMigrations(adapt(db));

    expect(() => addColored(db, 'none', '', '')).not.toThrow();
    expect(() => addColored(db, 'one', 'Navy', '')).not.toThrow();
    expect(() => addColored(db, 'two', 'Navy', 'Cream')).not.toThrow();
  });

  it('rejects a colour outside the vocabulary', async () => {
    const db = v6Db();
    await runMigrations(adapt(db));

    expect(() => addColored(db, 'bad', 'Chartreuse', '')).toThrow(/CHECK constraint failed/);
    expect(() => addColored(db, 'bad2', 'Navy', 'Chartreuse')).toThrow(/CHECK constraint failed/);
  });

  it('rejects a second colour with no first', async () => {
    const db = v6Db();
    await runMigrations(adapt(db));

    expect(() => addColored(db, 'orphan', '', 'Navy')).toThrow(/CHECK constraint failed/);
  });

  it('rejects the same colour twice', async () => {
    const db = v6Db();
    await runMigrations(adapt(db));

    expect(() => addColored(db, 'dupe', 'Navy', 'Navy')).toThrow(/CHECK constraint failed/);
  });

  it('rejects Multi paired with a specific colour, in either position', async () => {
    // Forbidding Multi as the primary is not enough on its own: without the
    // second rule it slips into the secondary column, which is as meaningless.
    const db = v6Db();
    await runMigrations(adapt(db));

    expect(() => addColored(db, 'm1', 'Multi', 'Red')).toThrow(/CHECK constraint failed/);
    expect(() => addColored(db, 'm2', 'Red', 'Multi')).toThrow(/CHECK constraint failed/);
    expect(() => addColored(db, 'm3', 'Multi', '')).not.toThrow();
  });

  it('indexes primaryColor, which Phase 5 filters on', async () => {
    const db = v6Db();
    await runMigrations(adapt(db));

    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM ClothingItems WHERE primaryColor = 'Navy'")
      .all() as { detail: string }[];
    expect(plan.map((r) => r.detail).join(' ')).toMatch(/USING (COVERING )?INDEX/);
  });

  it('keeps every verdict across this rebuild too', async () => {
    const db = v6Db();
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

describe('v7 -> v8: hardware colour widened to Brass and Black', () => {
  function v7Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 7)) db.exec(migration);
    db.exec('PRAGMA user_version = 7;');
    return db;
  }

  const addWithHardware = (db: DatabaseSync, id: string, hw: string) =>
    db
      .prepare(
        `INSERT INTO ClothingItems (id, imagePath, category, hardwareColor, createdAt)
         VALUES (?,?,?,?,?)`,
      )
      .run(id, '', 'Belt', hw, 'then');

  it('rejects Brass and Black before the migration runs', () => {
    const db = v7Db();
    expect(() => addWithHardware(db, 'bad', 'Brass')).toThrow(/CHECK constraint failed/);
  });

  it('accepts Brass and Black afterwards, still rejects anything else', async () => {
    const db = v7Db();
    await runMigrations(adapt(db));

    for (const hw of ['Gold', 'Silver', 'Brass', 'Black', 'None']) {
      expect(() => addWithHardware(db, `hw-${hw}`, hw)).not.toThrow();
    }
    expect(() => addWithHardware(db, 'bad', 'Copper')).toThrow(/CHECK constraint failed/);
  });

  it('keeps every verdict across this rebuild too', async () => {
    const db = v7Db();
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

describe('v8 -> v9: Dress and Sandals categories', () => {
  function v8Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 8)) db.exec(migration);
    db.exec('PRAGMA user_version = 8;');
    return db;
  }

  it('rejects Dress and Sandals before the migration runs', () => {
    const db = v8Db();
    expect(() => addItem(db, 'bad-dress', 'Dress')).toThrow(/CHECK constraint failed/);
    expect(() => addItem(db, 'bad-sandals', 'Sandals')).toThrow(/CHECK constraint failed/);
  });

  it('accepts every current category afterwards, including the two new ones', async () => {
    const db = v8Db();
    await runMigrations(adapt(db));

    for (const [i, category] of ALL_CATEGORIES.entries()) {
      expect(() => addItem(db, `ok-${i}`, category)).not.toThrow();
    }
    expect(() => addItem(db, 'bad', 'Jumpsuit')).toThrow(/CHECK constraint failed/);
  });

  it('keeps every verdict across this rebuild too', async () => {
    const db = v8Db();
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

describe('v9 -> v10: sleeve length', () => {
  function v9Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 9)) db.exec(migration);
    db.exec('PRAGMA user_version = 9;');
    return db;
  }

  it('has no sleeveLength column before the migration runs', () => {
    const db = v9Db();
    expect(() => db.prepare('SELECT sleeveLength FROM ClothingItems').all()).toThrow();
  });

  it('defaults existing rows to Short, the adjustment table\'s neutral value', async () => {
    const db = v9Db();
    db.prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?,?,?,?)')
      .run('old', '', 'Top', 'then');

    await runMigrations(adapt(db));

    expect(
      db.prepare('SELECT sleeveLength AS s FROM ClothingItems WHERE id = ?').get('old'),
    ).toEqual({ s: 'Short' });
  });

  it('accepts every sleeve length and rejects anything else', async () => {
    const db = v9Db();
    await runMigrations(adapt(db));

    const insert = (id: string, sleeveLength: string) =>
      db
        .prepare(
          'INSERT INTO ClothingItems (id, imagePath, category, sleeveLength, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, '', 'Top', sleeveLength, 't');

    for (const sleeveLength of ['Sleeveless', 'Short', 'Long']) {
      expect(() => insert(`sl-${sleeveLength}`, sleeveLength)).not.toThrow();
    }
    expect(() => insert('bad', 'ThreeQuarter')).toThrow(/CHECK constraint failed/);
  });

  it('keeps every verdict across this migration too', async () => {
    const db = v9Db();
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

describe('v10 -> v11: Skirt category and length field', () => {
  function v10Db(): DatabaseSync {
    const db = freshDb();
    for (const migration of MIGRATIONS.slice(0, 10)) db.exec(migration);
    db.exec('PRAGMA user_version = 10;');
    return db;
  }

  it('rejects Skirt before the migration runs', () => {
    const db = v10Db();
    expect(() => addItem(db, 'bad-skirt', 'Skirt')).toThrow(/CHECK constraint failed/);
  });

  it('accepts every current category afterwards, including Skirt', async () => {
    const db = v10Db();
    await runMigrations(adapt(db));

    for (const [i, category] of ALL_CATEGORIES.entries()) {
      expect(() => addItem(db, `ok-${i}`, category)).not.toThrow();
    }
  });

  it('accepts each category\'s own length vocabulary and empty, rejects the other category\'s and junk', async () => {
    const db = v10Db();
    await runMigrations(adapt(db));

    const insert = (id: string, category: string, length: string) =>
      db
        .prepare(
          'INSERT INTO ClothingItems (id, imagePath, category, length, createdAt) VALUES (?,?,?,?,?)',
        )
        .run(id, '', category, length, 't');

    // Inserted post-migration (runMigrations above already ran to the latest
    // version, which by now includes v11 -> v12's rename), so the category
    // vocabulary here is 'Pants', not the pre-rename 'Bottom' this block's
    // own migration introduced — see the v11 -> v12 describe block below for
    // a test of the rename itself.
    for (const length of ['', 'Short', 'Mid-length', 'Capri', 'Cropped', 'Long']) {
      expect(() => insert(`bottom-${length}`, 'Pants', length)).not.toThrow();
    }
    for (const length of ['', 'Mini', 'Knee-length', 'Midi', 'Maxi']) {
      expect(() => insert(`skirt-${length}`, 'Skirt', length)).not.toThrow();
    }

    expect(() => insert('bad1', 'Pants', 'Mini')).toThrow(/CHECK constraint failed/);
    expect(() => insert('bad2', 'Skirt', 'Long')).toThrow(/CHECK constraint failed/);
    expect(() => insert('bad3', 'Top', 'Short')).toThrow(/CHECK constraint failed/);
    expect(() => insert('bad4', 'Pants', 'Nonsense')).toThrow(/CHECK constraint failed/);
  });

  it('keeps every verdict across this rebuild too', async () => {
    const db = v10Db();
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
