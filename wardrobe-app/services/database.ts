import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

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

/** Opens the database if needed and brings its schema up to date. */
export async function initDatabase(): Promise<void> {
  const db = await getDatabase();
  await runMigrations(db);
}

// TODO (Phase 2): wearCount is intentionally NOT auto-incremented via a SQL
// trigger, to avoid depending on the JSON1 extension (json_each) being
// compiled into Expo's bundled SQLite. Instead, when the "log an outfit"
// service is built, wrap the insert and the per-item increment in one
// transaction, e.g.:
//
//   await db.withTransactionAsync(async () => {
//     await db.runAsync(
//       'INSERT INTO Outfit_Logs (id, date, itemIds, collageImageUri, createdAt) VALUES (?, ?, ?, ?, ?)',
//       [id, date, JSON.stringify(itemIds), collageImageUri, createdAt]
//     );
//     for (const itemId of itemIds) {
//       await db.runAsync(
//         'UPDATE ClothingItems SET wearCount = wearCount + 1 WHERE id = ?',
//         [itemId]
//       );
//     }
//   });
