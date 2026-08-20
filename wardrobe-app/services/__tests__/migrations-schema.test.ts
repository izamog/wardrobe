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
