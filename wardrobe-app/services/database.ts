import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';
import type { ItemsDatabase } from './items';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Returns the shared database connection, opening it on the first call.
 *
 * Caches the *promise* rather than the resolved handle so that callers which
 * arrive while the first open is still in flight all await the same connection.
 * Caching the resolved handle instead lets every caller that runs before the
 * first `await` settles open a connection of its own and leak it.
 *
 * Foreign keys are enabled here rather than in initDatabase() because the
 * pragma is per-connection: a caller that reached the database without going
 * through initDatabase() would otherwise hold a connection on which
 * ON DELETE CASCADE silently does nothing.
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('wardrobe.db');
      // Must run outside any transaction, which is why it lives here rather
      // than alongside the migrations.
      await db.execAsync('PRAGMA foreign_keys = ON;');
      return db;
    })().catch((e: unknown) => {
      // Clear the cache so a failed open can be retried rather than every
      // later call replaying the same rejected promise.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/**
 * Runs `fn` against the shared connection.
 *
 * Screens call this rather than getDatabase() so they never hold a connection
 * handle of their own. The callback takes the ItemsDatabase seam, which keeps
 * services/items.ts free of any import of expo-sqlite — that module is
 * therefore testable off-device, and this one stays the single place native
 * SQLite is touched.
 */
export async function withDb<T>(fn: (db: ItemsDatabase) => Promise<T>): Promise<T> {
  return fn(await getDatabase());
}

/** Opens the database if needed and brings its schema up to date. */
export async function initDatabase(): Promise<void> {
  const db = await getDatabase();
  await runMigrations(db);
}

// wearCount is intentionally NOT auto-incremented via a SQL trigger, to avoid
// depending on the JSON1 extension (json_each) being compiled into Expo's
// bundled SQLite. Instead, logging an outfit and crediting each of its
// items' wearCount happen in one transaction — see logOutfitWorn in
// services/items.ts.
