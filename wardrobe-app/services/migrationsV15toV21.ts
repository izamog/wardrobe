/** v15 -> v22 migration entries -- see migrations.ts for the full ordering rules and MIGRATIONS assembly. */
export const MIGRATIONS_V15_V21: readonly string[] = [
  // v15 -> v16: enforce "at most two materials" as a CHECK, not just at the
  // application layer.
  //
  // services/items.ts's encodeMaterials already truncates on every write
  // this app makes, but that only covers callers going through insertItem/
  // updateItem -- a CHECK is what makes "at most two" true regardless of the
  // writer, the same guarantee category, colour and every other enumerated
  // column already have here. materials remains free-text-inside-JSON
  // (fibres aren't a fixed vocabulary the way category is), so the
  // constraint is about shape and count, not membership: valid JSON, an
  // array, at most two entries. json_valid/json_type/json_array_length are
  // SQLite's built-in JSON1 functions, part of SQLite itself (not a loadable
  // extension) since 3.38.0 (2022) -- both node:sqlite (these migrations'
  // own test driver) and the SQLite expo-sqlite bundles for SDK 54 are well
  // past that.
  //
  // A CHECK addition needs the same rebuild every widened/added CHECK above
  // does. Existing rows are truncated to their first two entries during the
  // copy (matching encodeMaterials' own "keep the first MAX_MATERIALS"
  // rule), not rejected -- a migration that fails outright on a pre-existing
  // over-length row would leave the whole app unable to open its database.
  // Anything that isn't a valid JSON array at all (see parseStringArrayColumn's
  // own tolerance for that) resets to '[]' rather than being carried forward
  // broken.
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
    purchasedAt TEXT NOT NULL DEFAULT '',
    materials TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(materials) AND json_type(materials) = 'array' AND json_array_length(materials) <= 2),
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
    archivedAt TEXT NOT NULL DEFAULT '',

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt
  )
  SELECT
    id, imagePath, originalImagePath, category, brand, costMinorUnits, isSecondHand,
    purchasedAt,
    CASE
      WHEN json_valid(materials) AND json_type(materials) = 'array' AND json_array_length(materials) > 2
        THEN json_array(json_extract(materials, '$[0]'), json_extract(materials, '$[1]'))
      WHEN json_valid(materials) AND json_type(materials) = 'array'
        THEN materials
      ELSE '[]'
    END,
    primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt
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

  // v16 -> v17: imageMarginBaked.
  //
  // StoredImage used to infer whether imagePath's pixels already carry
  // background-framer's baked margin purely from the '.png' extension. A
  // manual crop (ImageAdjustmentsScreen) can trim that margin away without changing the
  // extension, which left cropped cutouts rendering with no margin at all --
  // the garment filling its whole tile instead of keeping a sensible border.
  // This column makes that state explicit instead of guessed.
  //
  // A single column with a constant default is an in-place ADD COLUMN, same
  // reasoning as v9 -> v10's sleeveLength. Existing rows default to false
  // (no baked margin) even though most .png rows do have one: the false
  // default only costs those rows one extra display-time margin pass (see
  // FramedImage.tsx) until they're next saved, which looks like a slightly
  // larger border, never the broken edge-to-edge rendering this migration
  // exists to prevent. Defaulting to true would risk the opposite: an old,
  // pre-migration manually-cropped item silently going back to looking
  // margin-less forever.
  `
  ALTER TABLE ClothingItems ADD COLUMN imageMarginBaked INTEGER NOT NULL DEFAULT 0;
  `,

  // v17 -> v18: thickness, denier, backless.
  //
  // Three independent, self-contained additions delivered together as one
  // feature batch, each an in-place ADD COLUMN for the same reason
  // sleeveLength (v9 -> v10) and imageMarginBaked (v16 -> v17) were: every
  // CHECK below refers only to the column it's attached to, so none of them
  // forces a rebuild.
  //
  // thickness applies to every category (Mesh/Light/Regular/Thick/Heavy;
  // see THICKNESS_WARMTH_ADJUSTMENT in utils/warmth.ts), unlike sleeveLength
  // or length, which only mean something for specific categories -- 'Regular'
  // is the neutral default for the same reason 'Short' is sleeveLength's.
  //
  // denier only means something for Tights (utils/categories.ts's
  // denierApplies); 0 is the "not recorded" sentinel rather than an empty
  // string, since denier is numeric and real deniers never go below 5 --
  // matching costMinorUnits' own 0-means-unset convention, not length's
  // ''-means-unset one.
  //
  // backless applies to Top and Dress (utils/categories.ts's backlessApplies)
  // and drives a pairwise layering exclusion (clearsBacklessRule in
  // utils/pairs.ts), the same boolean-column shape as hasBeltLoops.
  `
  ALTER TABLE ClothingItems ADD COLUMN thickness TEXT NOT NULL DEFAULT 'Regular'
    CHECK (thickness IN ('Mesh','Light','Regular','Thick','Heavy'));
  ALTER TABLE ClothingItems ADD COLUMN denier INTEGER NOT NULL DEFAULT 0
    CHECK (denier = 0 OR (denier BETWEEN 5 AND 270));
  ALTER TABLE ClothingItems ADD COLUMN backless INTEGER NOT NULL DEFAULT 0
    CHECK (backless IN (0,1));
  `,

  // v18 -> v19: a Leggings vocabulary for length.
  //
  // Leggings length (Short/Knee-length/Capri/Long) needs its own branch in
  // the same category-dependent CHECK Pants and Skirt already have -- a
  // cross-column CHECK, which SQLite cannot widen in place, so this is a
  // rebuild, same reason and same child-before-parent ordering as every
  // other category/length widening (v2, v4, v5, v6, v8, v9, v10, v11, v12,
  // v13, v16).
  //
  // Short/Capri/Long are shared string values with Pants' own vocabulary
  // (and Knee-length with Skirt's), so LENGTH_WARMTH_ADJUSTMENT/
  // LENGTH_WIND_ADJUSTMENT in utils/warmth.ts need no new entries for
  // Leggings -- see that file's own comment on the shared-vocabulary
  // behaviour this relies on.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    imageMarginBaked INTEGER NOT NULL DEFAULT 0,
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
    purchasedAt TEXT NOT NULL DEFAULT '',
    materials TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(materials) AND json_type(materials) = 'array' AND json_array_length(materials) <= 2),
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
        OR (category = 'Leggings' AND length IN ('','Short','Knee-length','Capri','Long'))
        OR (category = 'Skirt' AND length IN ('','Mini','Knee-length','Midi','Maxi'))
        OR (category NOT IN ('Pants','Leggings','Skirt') AND length = '')
      ),
    thickness TEXT NOT NULL DEFAULT 'Regular'
      CHECK (thickness IN ('Mesh','Light','Regular','Thick','Heavy')),
    denier INTEGER NOT NULL DEFAULT 0 CHECK (denier = 0 OR (denier BETWEEN 5 AND 270)),
    backless INTEGER NOT NULL DEFAULT 0 CHECK (backless IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,
    archivedAt TEXT NOT NULL DEFAULT '',

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, imageMarginBaked, category, brand, costMinorUnits, isSecondHand,
    purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt
  )
  SELECT
    id, imagePath, originalImagePath, imageMarginBaked, category, brand, costMinorUnits, isSecondHand,
    purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt
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

  // v19 -> v20: Dress shares Skirt's length vocabulary.
  //
  // lengthOptionsFor (utils/categories.ts) already offers Mini/Knee-length/
  // Midi/Maxi for Dress -- the same values LENGTH_WARMTH_ADJUSTMENT/
  // LENGTH_WIND_ADJUSTMENT (utils/warmth.ts) already treat as equivalent for
  // Skirt and Dress. This is the matching database-side widening: without
  // it, saving a Dress with a length set violates the length CHECK below and
  // the write fails. Cross-column CHECK, same rebuild and child-before-parent
  // ordering as every other category/length widening (v2, v4, v5, v6, v8,
  // v9, v10, v11, v12, v13, v16, v19).
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    imageMarginBaked INTEGER NOT NULL DEFAULT 0,
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
    purchasedAt TEXT NOT NULL DEFAULT '',
    materials TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(materials) AND json_type(materials) = 'array' AND json_array_length(materials) <= 2),
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
        OR (category = 'Leggings' AND length IN ('','Short','Knee-length','Capri','Long'))
        OR (category IN ('Skirt','Dress') AND length IN ('','Mini','Knee-length','Midi','Maxi'))
        OR (category NOT IN ('Pants','Leggings','Skirt','Dress') AND length = '')
      ),
    thickness TEXT NOT NULL DEFAULT 'Regular'
      CHECK (thickness IN ('Mesh','Light','Regular','Thick','Heavy')),
    denier INTEGER NOT NULL DEFAULT 0 CHECK (denier = 0 OR (denier BETWEEN 5 AND 270)),
    backless INTEGER NOT NULL DEFAULT 0 CHECK (backless IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,
    archivedAt TEXT NOT NULL DEFAULT '',

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, imageMarginBaked, category, brand, costMinorUnits, isSecondHand,
    purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt
  )
  SELECT
    id, imagePath, originalImagePath, imageMarginBaked, category, brand, costMinorUnits, isSecondHand,
    purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt
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

  // v20 -> v21: a "work appropriate" flag, for Today's work-appropriate filter.
  //
  // A single column with a constant default and a CHECK that references
  // nothing but itself is an in-place ADD COLUMN, not a rebuild -- same
  // reasoning as purchasedAt and archivedAt above. Defaults to 0 (not work
  // appropriate) so every existing item starts unflagged rather than
  // silently opting in to a filter that didn't exist when it was added.
  `
  ALTER TABLE ClothingItems ADD COLUMN isWorkAppropriate INTEGER NOT NULL DEFAULT 0 CHECK (isWorkAppropriate IN (0,1));
  `,

  // v21 -> v22: split Shorts out of Pants into its own category.
  //
  // Shorts used to be "Pants at 'Short' length" (PantsLength's 'Short'
  // value); it's now its own Category with no `length` field at all (always
  // '' -- see types/wardrobe.ts's Category doc comment). Category
  // CHECK-widening, same rebuild and child-before-parent ordering as every
  // other one (v2, v4, v5, v6, v8, v9, v10, v11, v12, v13, v16, v19).
  //
  // The INSERT...SELECT remaps existing rows on the fly: any row that was
  // category='Pants' AND length='Short' becomes category='Shorts',
  // length='' (auto-migrated per direct feedback, rather than left for the
  // user to reclassify by hand); every other row is untouched.
  `
  CREATE TABLE ClothingItems_new (
    id TEXT PRIMARY KEY NOT NULL,
    imagePath TEXT NOT NULL,
    originalImagePath TEXT NOT NULL DEFAULT '',
    imageMarginBaked INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL
      CHECK (category IN (
        'T-Shirt','Top','Shirt','Cardigan','Sweater',
        'Jacket','Coat','Dress',
        'Pants','Shorts','Leggings','Skirt','Shoes','Boots','Sandals',
        'Belt','Bag','Scarf','Tights'
      )),
    brand TEXT NOT NULL DEFAULT 'Unknown',
    costMinorUnits INTEGER NOT NULL DEFAULT 0 CHECK (costMinorUnits >= 0),
    isSecondHand INTEGER NOT NULL DEFAULT 0 CHECK (isSecondHand IN (0,1)),
    purchasedAt TEXT NOT NULL DEFAULT '',
    materials TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(materials) AND json_type(materials) = 'array' AND json_array_length(materials) <= 2),
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
        OR (category = 'Leggings' AND length IN ('','Short','Knee-length','Capri','Long'))
        OR (category IN ('Skirt','Dress') AND length IN ('','Mini','Knee-length','Midi','Maxi'))
        OR (category NOT IN ('Pants','Leggings','Skirt','Dress') AND length = '')
      ),
    thickness TEXT NOT NULL DEFAULT 'Regular'
      CHECK (thickness IN ('Mesh','Light','Regular','Thick','Heavy')),
    denier INTEGER NOT NULL DEFAULT 0 CHECK (denier = 0 OR (denier BETWEEN 5 AND 270)),
    backless INTEGER NOT NULL DEFAULT 0 CHECK (backless IN (0,1)),
    inferredWarmth INTEGER NOT NULL DEFAULT 0 CHECK (inferredWarmth BETWEEN 0 AND 10),
    inferredWind INTEGER NOT NULL DEFAULT 0 CHECK (inferredWind BETWEEN 0 AND 10),
    wearCount INTEGER NOT NULL DEFAULT 0 CHECK (wearCount >= 0),
    createdAt TEXT NOT NULL,
    archivedAt TEXT NOT NULL DEFAULT '',
    isWorkAppropriate INTEGER NOT NULL DEFAULT 0 CHECK (isWorkAppropriate IN (0,1)),

    CHECK (primaryColor <> '' OR secondaryColor = ''),
    CHECK (secondaryColor = '' OR secondaryColor <> primaryColor),
    CHECK (primaryColor <> 'Multi' OR secondaryColor = ''),
    CHECK (secondaryColor <> 'Multi')
  );

  INSERT INTO ClothingItems_new (
    id, imagePath, originalImagePath, imageMarginBaked, category, brand, costMinorUnits, isSecondHand,
    purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    length, thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt,
    isWorkAppropriate
  )
  SELECT
    id, imagePath, originalImagePath, imageMarginBaked,
    CASE WHEN category = 'Pants' AND length = 'Short' THEN 'Shorts' ELSE category END,
    brand, costMinorUnits, isSecondHand,
    purchasedAt, materials, primaryColor, secondaryColor, hardwareColor, hasBeltLoops, sleeveLength,
    CASE WHEN category = 'Pants' AND length = 'Short' THEN '' ELSE length END,
    thickness, denier, backless, inferredWarmth, inferredWind, wearCount, createdAt, archivedAt,
    isWorkAppropriate
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
];
