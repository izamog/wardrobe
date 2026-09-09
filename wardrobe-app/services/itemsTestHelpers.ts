/**
 * @jest-environment node
 *
 * Shared node:sqlite test fixtures for the items.*.test.ts split -- runs the
 * real migrations against an in-memory DB so tests exercise the same CHECK
 * constraints, FK cascade and canonical-order rules the app runs.
 */
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, type MigratableDatabase } from './migrations';
import type { ItemsDatabase, NewClothingItem } from './items';

export function adaptForMigrations(db: DatabaseSync): MigratableDatabase {
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

export function adapt(db: DatabaseSync): ItemsDatabase {
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

export async function freshDb(): Promise<ItemsDatabase> {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  await runMigrations(adaptForMigrations(raw));
  return adapt(raw);
}

export const draft = (overrides: Partial<NewClothingItem> = {}): NewClothingItem => ({
  imagePath: '',
  originalImagePath: '',
  imageMarginBaked: false,
  primaryColor: '',
  secondaryColor: '',
  category: 'Top',
  brand: 'Unbranded',
  costMinorUnits: 0,
  isSecondHand: false,
  isWorkAppropriate: false,
  purchasedAt: '',
  materials: [],
  hardwareColor: 'None',
  hasBeltLoops: false,
  sleeveLength: 'Short',
  length: '',
  thickness: 'Regular',
  denier: 0,
  backless: false,
  inferredWarmth: 0,
  inferredWind: 0,
  ...overrides,
});
