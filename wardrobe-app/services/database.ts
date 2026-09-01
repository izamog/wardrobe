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
 * Runs `fn` against the shared connection, once the schema is up to date.
 *
 * Screens call this rather than getDatabase() so they never hold a connection
 * handle of their own. The callback takes the ItemsDatabase seam, which keeps
 * services/items.ts free of any import of expo-sqlite — that module is
 * therefore testable off-device, and this one stays the single place native
 * SQLite is touched.
 *
 * Awaits initDatabase() first (memoized — a no-op await once migrations have
 * already finished) rather than assuming some other caller already gated on
 * it. App.tsx no longer blocks rendering the whole app behind a splash until
 * the database is ready — every screen renders immediately and shows its own
 * loading state instead — so this is what keeps a screen that queries the
 * database the moment it mounts from ever reading a not-yet-migrated schema.
 */
export async function withDb<T>(fn: (db: ItemsDatabase) => Promise<T>): Promise<T> {
  await initDatabase();
  return fn(await getDatabase());
}

let initPromise: Promise<void> | null = null;

/**
 * Opens the database if needed and brings its schema up to date.
 *
 * Memoized the same way getDatabase() is, so a second caller that arrives
 * while migrations are still running awaits the same promise rather than
 * re-running them. This lets contexts/TodayDataContext.tsx call it directly
 * to gate its own database-dependent work on migrations having finished,
 * without needing App.tsx's own initDatabase() call to be the only caller.
 */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDatabase();
      await runMigrations(db);
    })().catch((e: unknown) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

// wearCount is intentionally NOT auto-incremented via a SQL trigger, to avoid
// depending on the JSON1 extension (json_each) being compiled into Expo's
// bundled SQLite. Instead, logging an outfit and crediting each of its
// items' wearCount happen in one transaction — see logOutfitWorn in
// services/items.ts.
