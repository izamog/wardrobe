/** v7 -> v15 migration entries -- see migrations.ts for the full ordering rules and MIGRATIONS assembly. */
export const MIGRATIONS_V7_V14: readonly string[] = [
  // v7 -> v8: hardware colour widened to Brass and Black.
  //
  // Phase 4's belt/bag matching rule needs both: Gold pairs with Brass as well
  // as Gold, and Silver pairs with Black as well as Silver. Narrowing was never
  // the goal here, only adding two members, but SQLite still cannot alter a
  // CHECK constraint in place, so this is a rebuild for the same reason as v2,
  // v4, v5 and v6 -- see v2 for why Item_Compatibility has to be copied out and
  // dropped before ClothingItems rather than after.
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
    primaryColor TEXT NOT NULL DEFAULT ''
      CHECK (primaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    secondaryColor TEXT NOT NULL DEFAULT ''
      CHECK (secondaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','Brass','Black','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops,
    inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops,
    inferredWarmth, inferredWind, wearCount, createdAt
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
  CREATE INDEX idx_items_primary_color ON ClothingItems(primaryColor);
  `,

  // v8 -> v9: two new categories, Dress and Sandals.
  //
  // Dress fills both the Top and Bottom slots at once rather than either one
  // -- utils/categories.ts's CONFLICTING_GROUPS and utils/layering.ts's
  // Dress pairs are what encode that once the value can be stored at all.
  // Sandals is a second Shoes-slot category, no different in kind from Shoes
  // itself. Same rebuild reason and same child-before-parent ordering as v2,
  // v4, v5, v6 and v8 -- see v2 for why.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat','Dress',
        'Bottom','Shoes','Sandals','Belt','Bag','Scarf'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    primaryColor TEXT NOT NULL DEFAULT ''
      CHECK (primaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    secondaryColor TEXT NOT NULL DEFAULT ''
      CHECK (secondaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','Brass','Black','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops,
    inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops,
    inferredWarmth, inferredWind, wearCount, createdAt
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
  CREATE INDEX idx_items_primary_color ON ClothingItems(primaryColor);
  `,

  // v9 -> v10: sleeve length.
  //
  // 'Top' alone conflates a sleeveless tank and a loose long-sleeve jersey
  // top, and utils/warmth.ts needs to tell those apart -- coverage changes
  // both warmth and wind resistance independent of category or fabric. See
  // the SleeveLength doc comment in types/wardrobe.ts.
  //
  // A single column with a constant default is an in-place ADD COLUMN, not a
  // rebuild: unlike the two-column colour CHECKs in v7, this constraint
  // depends on nothing but this one column. 'Short' is the default because it
  // is also the adjustment table's neutral value (see utils/warmth.ts) -- an
  // existing item's estimate does not change just because this column now
  // exists, only once someone corrects it to Sleeveless or Long.
  `
  ALTER TABLE ClothingItems ADD COLUMN sleeveLength TEXT NOT NULL DEFAULT 'Short'
    CHECK (sleeveLength IN ('Sleeveless','Short','Long'));
  `,

  // v10 -> v11: a Skirt category, and a length field for it and Bottom.
  //
  // Skirt shares Bottom's outfit slot (utils/categories.ts's CATEGORY_GROUP),
  // so this needs the category CHECK widened, which SQLite cannot do
  // in-place -- a rebuild, same reason and same child-before-parent ordering
  // as v2, v4, v5, v6, v8 and v9.
  //
  // length rides along in the same rebuild rather than a separate ADD COLUMN
  // migration: its CHECK has to reference the category column (Bottom and
  // Skirt each have their own vocabulary -- see GarmentLength in
  // types/wardrobe.ts), and a CHECK added via ADD COLUMN may only refer to
  // the column being added, not another one. '' is valid for every category,
  // not just the two this applies to: it means "not recorded", the same
  // convention primaryColor/secondaryColor already use, chosen over a guessed
  // default because Bottom and Skirt share no neutral value the way every
  // sleeveLength-applicable category shares 'Short'.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat','Dress',
        'Bottom','Skirt','Shoes','Sandals','Belt','Bag','Scarf'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    primaryColor TEXT NOT NULL DEFAULT ''
      CHECK (primaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    secondaryColor TEXT NOT NULL DEFAULT ''
      CHECK (secondaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','Brass','Black','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    sleeveLength TEXT NOT NULL DEFAULT 'Short'
      CHECK (sleeveLength IN ('Sleeveless','Short','Long')),
    length TEXT NOT NULL DEFAULT ''
      CHECK (
        (category = 'Bottom' AND length IN ('','Short','Mid-length','Capri','Cropped','Long'))
        OR (category = 'Skirt' AND length IN ('','Mini','Knee-length','Midi','Maxi'))
        OR (category NOT IN ('Bottom','Skirt') AND length = '')
      ),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    inferredWarmth, inferredWind, wearCount, createdAt
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
  CREATE INDEX idx_items_primary_color ON ClothingItems(primaryColor);
  `,

  // v11 -> v12: rename the 'Bottom' category to 'Pants'.
  //
  // 'Bottom' was ambiguous once Skirt joined the same outfit slot (v10 -> v11)
  // -- it read as the umbrella term for the whole slot even though it was
  // really one specific garment type (trousers, jeans, shorts) sitting beside
  // Skirt, not above it. 'Pants' says what it actually is; the umbrella is
  // still there, just at the CategoryGroup level (CATEGORY_GROUP['Pants'] =
  // CATEGORY_GROUP['Skirt'] = 'Bottom' in utils/categories.ts), which was
  // never a stored value and so needed no migration of its own.
  //
  // A rename of a CHECK-constrained value needs the same rebuild as widening
  // one -- SQLite cannot alter either in place -- so this reuses the v10 -> v11
  // table shape verbatim except for the category vocabulary and the length
  // CHECK's Bottom branch, both renamed to Pants. Existing rows are rewritten
  // during the copy: a plain `category` column reference in the SELECT would
  // otherwise carry 'Bottom' values straight into a CHECK that no longer
  // allows them and fail the whole migration.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat','Dress',
        'Pants','Skirt','Shoes','Sandals','Belt','Bag','Scarf'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    primaryColor TEXT NOT NULL DEFAULT ''
      CHECK (primaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    secondaryColor TEXT NOT NULL DEFAULT ''
      CHECK (secondaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','Brass','Black','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    sleeveLength TEXT NOT NULL DEFAULT 'Short'
      CHECK (sleeveLength IN ('Sleeveless','Short','Long')),
    length TEXT NOT NULL DEFAULT ''
      CHECK (
        (category = 'Pants' AND length IN ('','Short','Mid-length','Capri','Cropped','Long'))
        OR (category = 'Skirt' AND length IN ('','Mini','Knee-length','Midi','Maxi'))
        OR (category NOT IN ('Pants','Skirt') AND length = '')
      ),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath,
    CASE WHEN category = 'Bottom' THEN 'Pants' ELSE category END,
    brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, inferredWarmth, inferredWind, wearCount, createdAt
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
  CREATE INDEX idx_items_primary_color ON ClothingItems(primaryColor);
  `,

  // v12 -> v13: widen the category vocabulary with 'Boots', 'Leggings' and
  // 'Tights'.
  //
  // Pure additions -- no existing value is renamed or reinterpreted, so the
  // copy below is a straight SELECT unlike the v11 -> v12 CASE rewrite.
  // SQLite still cannot widen a CHECK in place, so this is the same
  // rebuild-and-swap shape as every migration before it.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat','Dress',
        'Pants','Leggings','Skirt','Shoes','Boots','Sandals',
        'Belt','Bag','Scarf','Tights'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    materials TEXT NOT NULL DEFAULT '[]',
    primaryColor TEXT NOT NULL DEFAULT ''
      CHECK (primaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    secondaryColor TEXT NOT NULL DEFAULT ''
      CHECK (secondaryColor IN (
        '','Black','Grey','White','Cream','Beige','Tan','Brown','Burgundy',
        'Red','Pink','Orange','Yellow','Olive','Green','Teal','Blue','Navy',
        'Purple','Gold','Silver','Multi'
      )),
    hardwareColor TEXT NOT NULL DEFAULT 'None'
      CHECK (hardwareColor IN ('Gold','Silver','Brass','Black','None')),
    hasBeltLoops INTEGER NOT NULL DEFAULT 0 CHECK (hasBeltLoops IN (0,1)),
    sleeveLength TEXT NOT NULL DEFAULT 'Short'
      CHECK (sleeveLength IN ('Sleeveless','Short','Long')),
    length TEXT NOT NULL DEFAULT ''
      CHECK (
        (category = 'Pants' AND length IN ('','Short','Mid-length','Capri','Cropped','Long'))
        OR (category = 'Skirt' AND length IN ('','Mini','Knee-length','Midi','Maxi'))
        OR (category NOT IN ('Pants','Skirt') AND length = '')
      ),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, inferredWarmth, inferredWind, wearCount, createdAt
  )
  SELECT
    id, imagePath, originalImagePath, category,
    brand, costMinorUnits, isSecondHand,
    materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, inferredWarmth, inferredWind, wearCount, createdAt
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
  CREATE INDEX idx_items_primary_color ON ClothingItems(primaryColor);
  `,

  // v13 -> v14: a free-text purchasedAt field ("a few years ago", "March
  // 2022", whatever the user actually knows or wants to say) — deliberately
  // not a parsed date. Most owners don't know an exact purchase date, and a
  // column that demanded one would either reject an honest "a while back" or
  // invite a fabricated exact date, which is worse than not asking.
  //
  // A single column with a constant default is an in-place ADD COLUMN, not a
  // rebuild — same reasoning as originalImagePath and sleeveLength above.
  `
  ALTER TABLE ClothingItems ADD COLUMN purchasedAt TEXT NOT NULL DEFAULT '';
  `,

  // v14 -> v15: soft-delete via archivedAt.
  //
  // '' means "not archived" -- an ordinary, listed item. A non-empty value is
  // the ISO timestamp a bulk-delete archived it at, which is both the "is it
  // archived" flag and the input to the 30-day retention check (see
  // ARCHIVE_RETENTION_DAYS in services/itemActions.ts), so no separate
  // boolean column is needed. listItems and listItemsInCategories both
  // exclude archived rows by default -- see services/items.ts -- so this
  // never has to be filtered ad hoc at every call site.
  `
  ALTER TABLE ClothingItems ADD COLUMN archivedAt TEXT NOT NULL DEFAULT '';
  `,

];
