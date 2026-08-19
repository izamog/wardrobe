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
  // v0 -> v1: baseline schema.
  //
  // The DROP statements exist for one narrow case: databases created by the
  // very first Phase 1 build, which set up tables before versioning existed
  // and so also report user_version = 0. Dropping them is lossless because
  // that build shipped no INSERT path at all -- there was no way to add an
  // item, so no row can exist. Later migrations must preserve data instead.
  `
  DROP TABLE IF EXISTS Item_Compatibility;
  DROP TABLE IF EXISTS Outfit_Logs;
  DROP TABLE IF EXISTS ClothingItems;

  -- Column CHECKs mirror the unions in types/wardrobe.ts. They are duplicated
  -- deliberately: TypeScript cannot police what SQLite accepts, and a row read
  -- back and cast to ClothingItem would otherwise carry a type that lies.
  -- services/__tests__/migrations.test.ts asserts the two stay in agreement.
  CREATE TABLE ClothingItems (
    id TEXT PRIMARY KEY NOT NULL,
    imageUri TEXT NOT NULL,
    category TEXT NOT NULL
      CHECK (category IN ('Top','Bottom','Outerwear','Shoes','Belt','Bag','Scarf')),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    -- Money in minor units (pence/cents) as an integer. REAL cannot represent
    -- most decimal amounts exactly, so sums and comparisons drift.
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL
  );

  -- item_a_id < item_b_id keeps each pair in one canonical order, so
  -- (A,B)=MATCH and (B,A)=DISMATCH can never coexist. It also rejects
  -- self-pairs, since an id is never less than itself. Application code must
  -- sort the two ids before every insert and query.
  CREATE TABLE Item_Compatibility (
    id TEXT PRIMARY KEY NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('MATCH','DISMATCH')),
    createdAt TEXT NOT NULL,
    FOREIGN KEY (item_a_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    FOREIGN KEY (item_b_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    CHECK (item_a_id < item_b_id),
    UNIQUE(item_a_id, item_b_id)
  );

  CREATE TABLE Outfit_Logs (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL
      CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    itemIds TEXT NOT NULL DEFAULT '[]',
    collageImageUri TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE INDEX idx_items_category ON ClothingItems(category);
  CREATE INDEX idx_logs_date ON Outfit_Logs(date);

  -- No index on (item_a_id, item_b_id): the UNIQUE constraint above already
  -- creates one, and it serves item_a_id-only lookups too. item_b_id needs its
  -- own, because canonical ordering means "every rule involving item X" has to
  -- match either column, and this table grows O(n^2) with wardrobe size.
  CREATE INDEX idx_compat_item_b ON Item_Compatibility(item_b_id);
  `,

  // v1 -> v2: replace the category CHECK with the garment-level categories.
  //
  // SQLite cannot alter a CHECK constraint, so ClothingItems has to be rebuilt.
  // The order below is the whole point of this migration's length: with foreign
  // keys on, DROP TABLE on a parent fires the children's ON DELETE CASCADE, so
  // dropping ClothingItems while Item_Compatibility still references it would
  // silently delete every recorded verdict. Copying the verdicts out and
  // dropping the child before the parent means nothing cascades. Turning the
  // pragma off instead is not an option: it is a no-op inside a transaction,
  // and every migration runs inside one.
  //
  // 'Top' and 'Outerwear' stay valid so items created before the specific
  // types existed still load. Nothing is rewritten -- guessing whether an old
  // 'Top' was a T-Shirt or a Sweater is not the migration's call to make.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imageUri TEXT NOT NULL,
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Shirt','Tank','Sweater','Top',
        'Jacket','Coat','Outerwear',
        'Bottom','Shoes','Belt','Bag','Scarf'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL
  );

  -- Columns listed explicitly rather than SELECT *: a positional copy would
  -- silently misalign if the two definitions ever drift.
  INSERT INTO ClothingItems_new (
    id, imageUri, category, brand, costMinorUnits, isSecondHand, materials,
    hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imageUri, category, brand, costMinorUnits, isSecondHand, materials,
    hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  FROM ClothingItems;

  -- Constraint-free holding table. It exists only between the DROP and the
  -- re-INSERT below, and it must not carry the foreign keys, because for those
  -- few statements the table they point at does not exist.
  CREATE TABLE Item_Compatibility_backup (
    id TEXT NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  INSERT INTO Item_Compatibility_backup (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility;

  DROP TABLE Item_Compatibility;
  DROP TABLE ClothingItems;
  ALTER TABLE ClothingItems_new RENAME TO ClothingItems;

  CREATE TABLE Item_Compatibility (
    id TEXT PRIMARY KEY NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('MATCH','DISMATCH')),
    createdAt TEXT NOT NULL,
    FOREIGN KEY (item_a_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    FOREIGN KEY (item_b_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    CHECK (item_a_id < item_b_id),
    UNIQUE(item_a_id, item_b_id)
  );
  INSERT INTO Item_Compatibility (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility_backup;
  DROP TABLE Item_Compatibility_backup;

  -- Both indexes went with their tables and have to be rebuilt. idx_logs_date
  -- is untouched because Outfit_Logs was never dropped.
  CREATE INDEX idx_items_category ON ClothingItems(category);
  CREATE INDEX idx_compat_item_b ON Item_Compatibility(item_b_id);
  `,

  // v2 -> v3: photos on disk.
  //
  // imageUri becomes imagePath because the column now holds a path relative to
  // the app's document directory, not a URI. That distinction is the whole
  // point: iOS changes the app container's UUID on reinstall and on some
  // updates, so an absolute file:// URI stored today is a dead link tomorrow
  // and every photo in the closet silently breaks. The absolute location is
  // rebuilt at render time.
  //
  // originalImagePath keeps the unprocessed photo. Background removal is
  // deferred, and when it lands it needs a source to work from -- without the
  // original, applying it to an existing wardrobe would mean re-photographing
  // everything.
  //
  // No table rebuild here: RENAME COLUMN and ADD COLUMN are both in-place, and
  // ADD COLUMN accepts NOT NULL because the default is a constant.
  `
  ALTER TABLE ClothingItems RENAME COLUMN imageUri TO imagePath;
  ALTER TABLE ClothingItems ADD COLUMN originalImagePath TEXT NOT NULL DEFAULT '';

  -- Existing rows predate the camera and hold '', so this changes nothing
  -- today. It is here so the invariant "a row with a photo has an original"
  -- holds for every row, not just the ones written from now on.
  UPDATE ClothingItems SET originalImagePath = imagePath WHERE imagePath <> '';
  `,

  // v3 -> v4: settle the garment vocabulary.
  //
  // 'Tank' is folded into 'Top', which takes over its layering rules, and the
  // generic 'Outerwear' goes away now that Jacket and Coat cover it. 'Cardigan'
  // is new. Widening or narrowing the CHECK means another rebuild, so this
  // repeats the ordering from v2 -- verdicts copied out, child dropped before
  // parent -- for the same reason: with foreign keys on, dropping the parent
  // fires ON DELETE CASCADE and deletes the whole compatibility matrix without
  // erroring.
  //
  // The remapping runs against the old table first, while both the old and new
  // values still satisfy the old CHECK.
  //
  // Outerwear -> Jacket is a guess. It is the more common garment, the row
  // survives, and the category is editable; the alternative was refusing to
  // migrate a category the user asked to have removed.
  `
  UPDATE ClothingItems SET category = 'Top' WHERE category = 'Tank';
  UPDATE ClothingItems SET category = 'Jacket' WHERE category = 'Outerwear';

  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat',
        'Bottom','Shoes','Belt','Bag','Scarf'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  FROM ClothingItems;

  CREATE TABLE Item_Compatibility_backup (
    id TEXT NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  INSERT INTO Item_Compatibility_backup (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility;

  DROP TABLE Item_Compatibility;
  DROP TABLE ClothingItems;
  ALTER TABLE ClothingItems_new RENAME TO ClothingItems;

  CREATE TABLE Item_Compatibility (
    id TEXT PRIMARY KEY NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('MATCH','DISMATCH')),
    createdAt TEXT NOT NULL,
    FOREIGN KEY (item_a_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    FOREIGN KEY (item_b_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    CHECK (item_a_id < item_b_id),
    UNIQUE(item_a_id, item_b_id)
  );
  INSERT INTO Item_Compatibility (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility_backup;
  DROP TABLE Item_Compatibility_backup;

  CREATE INDEX idx_items_category ON ClothingItems(category);
  CREATE INDEX idx_compat_item_b ON Item_Compatibility(item_b_id);
  `,

  // v4 -> v5: warmth and windproof move from a 0-10 scale to 0-5.
  //
  // 1-5 is the range the app will generate on; 0 stays as "not assessed yet",
  // which is every row until Phase 3 starts filling these in from the spoken
  // description. Narrowing a CHECK means another rebuild, and the same
  // child-before-parent ordering as v2 and v4 -- see v2 for why.
  //
  // Existing values are clamped rather than reset. The old editor allowed up
  // to 10, so a hand-set 7 could be sitting in a row; clamping keeps the
  // ranking that value expressed, where zeroing it would throw the judgement
  // away. Phase 5's thermal targets are written against 0-5 from here on.
  `
  UPDATE ClothingItems SET inferredWarmth = 5 WHERE inferredWarmth > 5;
  UPDATE ClothingItems SET inferredWind = 5 WHERE inferredWind > 5;

  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat',
        'Bottom','Shoes','Belt','Bag','Scarf'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 5),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 5),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  FROM ClothingItems;

  CREATE TABLE Item_Compatibility_backup (
    id TEXT NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  INSERT INTO Item_Compatibility_backup (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility;

  DROP TABLE Item_Compatibility;
  DROP TABLE ClothingItems;
  ALTER TABLE ClothingItems_new RENAME TO ClothingItems;

  CREATE TABLE Item_Compatibility (
    id TEXT PRIMARY KEY NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('MATCH','DISMATCH')),
    createdAt TEXT NOT NULL,
    FOREIGN KEY (item_a_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    FOREIGN KEY (item_b_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    CHECK (item_a_id < item_b_id),
    UNIQUE(item_a_id, item_b_id)
  );
  INSERT INTO Item_Compatibility (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility_backup;
  DROP TABLE Item_Compatibility_backup;

  CREATE INDEX idx_items_category ON ClothingItems(category);
  CREATE INDEX idx_compat_item_b ON Item_Compatibility(item_b_id);
  `,

  // v5 -> v6: warmth and windproof go back to 0-10.
  //
  // v5 narrowed them to 0-5 and this reverses it, so on a database that has
  // not yet run either the pair is a no-op in schema terms. Appending rather
  // than editing v5 is not bureaucracy: a device that already ran v5 will
  // never run it again, so editing it there would leave the column at 0-5
  // while this build believes it is 0-10, and the mismatch would only surface
  // as a CHECK failure the first time someone typed a 7.
  //
  // The cost of appending is that v5's clamp still runs on a database sitting
  // at v4, so a hand-set value above 5 is lost on the way through. These are
  // placeholders that Phase 3 regenerates, so that is the cheaper of the two
  // risks.
  //
  // 0-10 is the scale Phase 5's thermal targets are computed on; the two have
  // to agree because an outfit qualifies when its pieces' scores sum to at
  // least the target.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat',
        'Bottom','Shoes','Belt','Bag','Scarf'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, hardwareColor, hasBeltLoops, inferredWarmth, inferredWind, wearCount, createdAt
  FROM ClothingItems;

  CREATE TABLE Item_Compatibility_backup (
    id TEXT NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  INSERT INTO Item_Compatibility_backup (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility;

  DROP TABLE Item_Compatibility;
  DROP TABLE ClothingItems;
  ALTER TABLE ClothingItems_new RENAME TO ClothingItems;

  CREATE TABLE Item_Compatibility (
    id TEXT PRIMARY KEY NOT NULL,
    item_a_id TEXT NOT NULL,
    item_b_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('MATCH','DISMATCH')),
    createdAt TEXT NOT NULL,
    FOREIGN KEY (item_a_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    FOREIGN KEY (item_b_id) REFERENCES ClothingItems(id) ON DELETE CASCADE,
    CHECK (item_a_id < item_b_id),
    UNIQUE(item_a_id, item_b_id)
  );
  INSERT INTO Item_Compatibility (id, item_a_id, item_b_id, status, createdAt)
    SELECT id, item_a_id, item_b_id, status, createdAt FROM Item_Compatibility_backup;
  DROP TABLE Item_Compatibility_backup;

  CREATE INDEX idx_items_category ON ClothingItems(category);
  CREATE INDEX idx_compat_item_b ON Item_Compatibility(item_b_id);
  `,
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
