/**
 * @jest-environment node
 *
 * These cover the ordering between the database and the filesystem, which is
 * the only reason itemActions exists. Both stores are fakes: the point is not
 * that SQLite works — items.test.ts covers that — but that a failure on one
 * side leaves the other side clean.
 */
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, type MigratableDatabase } from '../migrations';
import { getItem, insertItem, type ItemsDatabase } from '../items';
import {
  createItem,
  removeItem,
  replaceItemImage,
  type ImageStore,
  type ItemDraft,
  type RunQuery,
} from '../itemActions';
import type { ClothingItem } from '../../types/wardrobe';

/** Records what was written and deleted, and can be told to fail. */
function fakeImages() {
  const persisted: string[] = [];
  const removed: string[] = [];
  let failNextPersist = false;

  const store: ImageStore = {
    persist(_temporaryUri, itemId) {
      if (failNextPersist) throw new Error('disk full');
      const path = `items/${itemId}-${persisted.length}.jpg`;
      persisted.push(path);
      return path;
    },
    remove(relativePath) {
      removed.push(relativePath);
    },
  };

  return {
    store,
    persisted,
    removed,
    failPersist() {
      failNextPersist = true;
    },
  };
}

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
  };
}

async function freshRunQuery(): Promise<{ runQuery: RunQuery; db: ItemsDatabase }> {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  await runMigrations(adaptForMigrations(raw));
  const db = adapt(raw);
  return { runQuery: (fn) => fn(db), db };
}

/** A runQuery that always fails, standing in for a rejected write. */
const failingRunQuery: RunQuery = () => Promise.reject(new Error('database is locked'));

const draft: ItemDraft = {
  category: 'T-Shirt',
  primaryColor: '',
  secondaryColor: '',
  brand: 'Unknown',
  costMinorUnits: 0,
  isSecondHand: false,
  materials: [],
  hardwareColor: 'None',
  hasBeltLoops: false,
  inferredWarmth: 0,
  inferredWind: 0,
};

const storedItem = (overrides: Partial<ClothingItem> = {}): ClothingItem => ({
  id: 'item-1',
  imagePath: 'items/item-1-0.jpg',
  originalImagePath: 'items/item-1-0.jpg',
  ...draft,
  wearCount: 0,
  createdAt: 'then',
  ...overrides,
});

describe('createItem', () => {
  it('writes the file first, then the row pointing at it', async () => {
    const { runQuery, db } = await freshRunQuery();
    const images = fakeImages();

    const item = await createItem(
      { runQuery, images: images.store, newId: () => 'item-1' },
      draft,
      'file:///tmp/pick.jpg',
    );

    expect(images.persisted).toEqual(['items/item-1-0.jpg']);
    expect(item.imagePath).toBe('items/item-1-0.jpg');
    expect((await getItem(db, 'item-1'))?.imagePath).toBe('items/item-1-0.jpg');
  });

  it('points the original at the same file, so removal has a source later', async () => {
    const { runQuery } = await freshRunQuery();
    const images = fakeImages();

    const item = await createItem(
      { runQuery, images: images.store, newId: () => 'item-1' },
      draft,
      'file:///tmp/pick.jpg',
    );

    expect(item.originalImagePath).toBe(item.imagePath);
  });

  it('deletes the file it just wrote when the row fails', async () => {
    // The reason the file goes first: this direction leaks bytes, the other
    // leaves a row rendering a permanently broken tile.
    const images = fakeImages();

    await expect(
      createItem(
        { runQuery: failingRunQuery, images: images.store, newId: () => 'item-1' },
        draft,
        'file:///tmp/pick.jpg',
      ),
    ).rejects.toThrow('database is locked');

    expect(images.removed).toEqual(['items/item-1-0.jpg']);
  });

  it('writes no row when the file cannot be written', async () => {
    const { runQuery, db } = await freshRunQuery();
    const images = fakeImages();
    images.failPersist();

    await expect(
      createItem(
        { runQuery, images: images.store, newId: () => 'item-1' },
        draft,
        'file:///tmp/pick.jpg',
      ),
    ).rejects.toThrow('disk full');

    expect(await getItem(db, 'item-1')).toBeNull();
  });
});

describe('removeItem', () => {
  it('deletes the row before the files', async () => {
    const { runQuery, db } = await freshRunQuery();
    const images = fakeImages();
    await insertItem(db, { ...draft, imagePath: 'items/a.jpg', originalImagePath: 'items/a.jpg' }, 'item-1', 'then');

    await removeItem({ runQuery, images: images.store }, storedItem({ imagePath: 'items/a.jpg', originalImagePath: 'items/a.jpg' }));

    expect(await getItem(db, 'item-1')).toBeNull();
    expect(images.removed).toEqual(['items/a.jpg']);
  });

  it('deletes a distinct original as well as the displayed photo', async () => {
    const { runQuery } = await freshRunQuery();
    const images = fakeImages();

    await removeItem(
      { runQuery, images: images.store },
      storedItem({ imagePath: 'items/a-cutout.png', originalImagePath: 'items/a.jpg' }),
    );

    expect(images.removed.sort()).toEqual(['items/a-cutout.png', 'items/a.jpg']);
  });

  it('does not delete the same path twice when both columns match', async () => {
    const { runQuery } = await freshRunQuery();
    const images = fakeImages();

    await removeItem({ runQuery, images: images.store }, storedItem());

    expect(images.removed).toHaveLength(1);
  });

  it('ignores an empty path, so a photoless row deletes nothing', async () => {
    const { runQuery } = await freshRunQuery();
    const images = fakeImages();

    await removeItem(
      { runQuery, images: images.store },
      storedItem({ imagePath: '', originalImagePath: '' }),
    );

    expect(images.removed).toEqual([]);
  });

  it('leaves the files alone when the row could not be deleted', async () => {
    const images = fakeImages();

    await expect(
      removeItem({ runQuery: failingRunQuery, images: images.store }, storedItem()),
    ).rejects.toThrow('database is locked');

    expect(images.removed).toEqual([]);
  });
});

describe('replaceItemImage', () => {
  it('repoints the row at a new path and removes the old file', async () => {
    const { runQuery, db } = await freshRunQuery();
    const images = fakeImages();
    await insertItem(db, { ...draft, imagePath: 'items/old.jpg', originalImagePath: 'items/old.jpg' }, 'item-1', 'then');

    await replaceItemImage(
      { runQuery, images: images.store },
      storedItem({ imagePath: 'items/old.jpg', originalImagePath: 'items/old.jpg' }),
      'file:///tmp/new.jpg',
    );

    const stored = await getItem(db, 'item-1');
    expect(stored?.imagePath).toBe('items/item-1-0.jpg');
    expect(stored?.originalImagePath).toBe('items/item-1-0.jpg');
    expect(images.removed).toEqual(['items/old.jpg']);
  });

  it('gives the replacement a different path, so the image cache cannot serve the old one', async () => {
    const { runQuery } = await freshRunQuery();
    const images = fakeImages();

    await replaceItemImage(
      { runQuery, images: images.store },
      storedItem({ imagePath: 'items/old.jpg', originalImagePath: 'items/old.jpg' }),
      'file:///tmp/new.jpg',
    );

    expect(images.persisted[0]).not.toBe('items/old.jpg');
  });

  it('discards the new file and keeps the old one when the update fails', async () => {
    const images = fakeImages();

    await expect(
      replaceItemImage(
        { runQuery: failingRunQuery, images: images.store },
        storedItem({ imagePath: 'items/old.jpg', originalImagePath: 'items/old.jpg' }),
        'file:///tmp/new.jpg',
      ),
    ).rejects.toThrow('database is locked');

    expect(images.removed).toEqual(['items/item-1-0.jpg']);
    expect(images.removed).not.toContain('items/old.jpg');
  });
});
