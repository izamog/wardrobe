import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('wardrobe.db');
  }
  return dbInstance;
}

export async function initDatabase(): Promise<void> {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    -- Clothing Items Table
    CREATE TABLE IF NOT EXISTS ClothingItems (
      id TEXT PRIMARY KEY NOT NULL,
      imageUri TEXT NOT NULL,
      category TEXT NOT NULL,
      brand TEXT DEFAULT 'Unknown',
      cost REAL DEFAULT 0.00,
      isSecondHand INTEGER DEFAULT 0,
      materials TEXT DEFAULT '[]',
      hardwareColor TEXT DEFAULT 'None',
      hasBeltLoops INTEGER DEFAULT 0,
      inferredWarmth INTEGER DEFAULT 0,
      inferredWind INTEGER DEFAULT 0,
      wearCount INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    -- Compatibility Matrix Table
    -- item_a_id < item_b_id is enforced so a pair can only ever be stored in one
    -- canonical order, preventing (A,B)=MATCH and (B,A)=DISMATCH from coexisting.
    -- Normalize ordering in application code before every insert/query.
    CREATE TABLE IF NOT EXISTS Item_Compatibility (
      id TEXT PRIMARY KEY NOT NULL,
      item_a_id TEXT NOT NULL,
      item_b_id TEXT NOT NULL,
      status TEXT CHECK(status IN ('MATCH', 'DISMATCH')) NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (item_a_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
      FOREIGN KEY (item_b_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
      CHECK (item_a_id < item_b_id),
      UNIQUE(item_a_id, item_b_id)
    );

    -- Outfit Calendar Logs Table
    CREATE TABLE IF NOT EXISTS Outfit_Logs (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      itemIds TEXT NOT NULL,
      collageImageUri TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    -- Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_items_category ON ClothingItems(category);
    CREATE INDEX IF NOT EXISTS idx_compat_pair ON Item_Compatibility(item_a_id, item_b_id);
    CREATE INDEX IF NOT EXISTS idx_logs_date ON Outfit_Logs(date);
  `);
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
