/**
 * Shared setup for the migration test suite, split across migrations.test.ts
 * and migrations-schema.test.ts. Not itself a test file.
 */
import { DatabaseSync } from 'node:sqlite';
import type { MigratableDatabase } from './migrations';

/** Presents a node:sqlite database as the interface runMigrations expects. */
export function adapt(db: DatabaseSync): MigratableDatabase {
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

export function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export const userVersion = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

/** Inserts against the current schema, where the photo column is imagePath. */
export const addItem = (db: DatabaseSync, id: string, category = 'Top') =>
  db
    .prepare('INSERT INTO ClothingItems (id, imagePath, category, createdAt) VALUES (?, ?, ?, ?)')
    .run(id, '', category, '2026-01-01T00:00:00Z');

/**
 * Inserts against a schema older than v3, where the column is still imageUri.
 * Needed to seed the databases the upgrade tests then migrate.
 */
export const addLegacyItem = (db: DatabaseSync, id: string, category = 'Top') =>
  db
    .prepare('INSERT INTO ClothingItems (id, imageUri, category, createdAt) VALUES (?, ?, ?, ?)')
    .run(id, '', category, '2026-01-01T00:00:00Z');
