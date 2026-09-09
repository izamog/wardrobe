import { MIGRATIONS_V0_V6 } from './migrationsV0toV6';
import { MIGRATIONS_V7_V14 } from './migrationsV7toV14';
import { MIGRATIONS_V15_V21 } from './migrationsV15toV21';

/**
 * The slice of expo-sqlite's SQLiteDatabase that migrating needs.
 *
 * Declared structurally rather than importing the concrete type so this module
 * pulls in no native code, which lets the migrations run against any SQLite
 * driver — the app passes the real connection, tests pass node:sqlite.
 */
export interface MigratableDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * Ordered, append-only schema migrations.
 *
 * The database records how many of these have run in `PRAGMA user_version`.
 * The entry at index i moves the schema from version i to version i+1, so
 * user_version always equals the number of entries applied.
 *
 * Rules for adding to this list:
 *  - Append only. Never edit or reorder an entry that has already run on a
 *    device, because that device will never run it again.
 *  - Each entry must be safe to apply exactly once, in order, to a database
 *    left by the entry before it.
 *  - Entries run inside a transaction (see runMigrations), so a failure part
 *    way through one entry rolls that entry back rather than leaving the
 *    schema half-built.
 */
export const MIGRATIONS: readonly string[] = [
  ...MIGRATIONS_V0_V6,
  ...MIGRATIONS_V7_V14,
  ...MIGRATIONS_V15_V21,
];

/**
 * Applies every migration the database has not yet seen, in order.
 *
 * Each migration and the version bump recording it share one transaction, so
 * an interrupted run leaves the schema at a whole version rather than partway
 * through one. An already-current database does no work.
 *
 * @throws if the database reports a version this build does not know about,
 *   which means it was written by a newer build of the app.
 */
export async function runMigrations(db: MigratableDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const appliedCount = row?.user_version ?? 0;

  if (appliedCount > MIGRATIONS.length) {
    throw new Error(
      `Database schema version ${appliedCount} is newer than this build supports ` +
        `(${MIGRATIONS.length}). Update the app.`,
    );
  }

  for (let version = appliedCount; version < MIGRATIONS.length; version++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      // PRAGMA arguments cannot be bound as parameters. `version` is a loop
      // index over a module-local array and never derives from input.
      await db.execAsync(`PRAGMA user_version = ${version + 1};`);
    });
  }
}
