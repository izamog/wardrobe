# wardrobe

Local-first iOS app for organising clothing, recording which items go together,
and building weather-appropriate outfits from those rules.

The app lives in `wardrobe-app/`. Everything is on-device; there is no server.

## Status

**Phase 2 — photos.** Adding an item takes a photo and a category and nothing
else, because populating a wardrobe is the same two actions repeated dozens of
times. Everything else — brand, cost, materials, second-hand — is filled in
later on Item Details. Browse and filter the closet, edit or delete an item
(its photos and match records go with it), replace a photo, and rate pairs as
match/dismatch either from an item or through the Speed Matcher.

Background removal is **deferred**. Every cloud API's free tier is too small to
populate a wardrobe, and the free unlimited option — Apple's on-device subject
lifting — needs a native module, which Expo Go cannot load. It lands when the
project moves to a development build, which Phase 6 requires anyway. Photos are
stored as taken, and every item keeps its original so removal can later be run
over an existing wardrobe without re-photographing anything.

Still stubs: **Today** (weather and outfit generation, Phase 5) and **Calendar**
(outfit logs, collages and stats, Phase 6).

## Running it

Requires [Expo Go](https://expo.dev/go) on the phone. No Xcode needed.

```bash
cd wardrobe-app
npm install
npx expo start      # scan the QR code with Expo Go
```

The project targets **Expo SDK 54**, which is the newest SDK the App Store build
of Expo Go supports. Upgrading the SDK past what Expo Go ships means moving to a
custom development build, so check that before bumping it.

## Checks

```bash
npm test          # jest
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

From the repo root, `codacy-cli analyze --tool opengrep` runs static analysis;
`--tool trivy` scans dependencies. Note that Codacy's bundled ESLint has no
TypeScript parser and reports parse errors on every `.ts` file — the project's
own `npm run lint` is what actually lints this codebase.

## Layout

```
wardrobe-app/
  navigation/   the tab + stack navigators and their param types
  screens/      one file per screen
  components/   shared presentational pieces (tiles, chips, form fields)
  hooks/        useDbQuery — re-reads on screen focus
  services/     database connection, migrations, queries
  utils/        pure logic: category rules, pair selection, formatting
```

Only `services/database.ts` imports `expo-sqlite`. Everything else takes the
`ItemsDatabase` interface, which is what lets the query and mapping code run
under Jest against `node:sqlite` with no native runtime.

Every directory containing a `className` must appear in `tailwind.config.js`'s
`content` globs. A file outside them renders unstyled rather than erroring.

## Data model

Three tables, defined in `wardrobe-app/services/migrations.ts`:

- **ClothingItems** — one row per garment, with cost in minor units and CHECK
  constraints mirroring the unions in `types/wardrobe.ts`.
- **Item_Compatibility** — a MATCH/DISMATCH verdict per pair of items. Pairs are
  stored once in canonical id order (`item_a_id < item_b_id`), so a pair cannot
  hold two contradictory verdicts, and an item cannot pair with itself. Sort the
  two ids before every insert and query.
- **Outfit_Logs** — what was worn on a given date.

### Photos

Photos live in `<documentDirectory>/items/`, and the database stores a path
**relative** to that directory — never an absolute URI. iOS reassigns the app
container's UUID on reinstall and on some updates, so a stored absolute
`file://` URI becomes a dead link and every photo silently disappears.
`utils/imagePaths.ts` builds and resolves those paths and is pure; `services/
images.ts` is the only module that touches the camera, library or disk.

Each save writes to a new filename. Reusing the path would leave the URI
unchanged while the bytes behind it changed, and React Native caches images by
URI, so the old picture would keep rendering.

Writes that span both stores live in `services/itemActions.ts`, because the
ordering is the interesting part: the file is written before the row and
removed again if the row fails, so a row never points at a missing image.

### Categories and layering

`Category` is the garment type (T-Shirt, Top, Shirt, Cardigan, Sweater, Jacket,
Coat, Bottom, Shoes, Belt, Bag, Scarf). `CategoryGroup` is the outfit slot it
fills, so the five upper-body types all group as Top, and Jacket and Coat both
group as Outerwear. 'Outerwear' is a group but no longer a category.

Two categories in the same group normally can't appear together — they compete
for one slot. `utils/layering.ts` is the exception: it holds the directional
[inner, outer] rules that let a T-Shirt be worn under a Sweater, and it's what
`getComplementaryCategories` consults before excluding a same-group pair. One
rule needs three garments to state (a Shirt over a T-Shirt can't then go under
a Sweater), so it lives in `isValidLayerStack` rather than the pair table.

Attributes that only apply to some categories — hardware colour, belt loops —
are asked for only there, and cleared when the category changes away, so a
recategorised garment cannot carry an invisible flag into Phase 4's belt rules.
`inferredWarmth` and `inferredWind` are on a 1-5 scale (0 = not yet assessed)
and are generated by the app from Phase 3 onwards rather than asked of the
user. They are editable on Item Details only so a wrong value can be corrected
while that generation is being built. **Phase 5's thermal targets must be
written against 1-5** — the original plan's divisors assumed 0-10.

### Changing the schema

Append a new entry to `MIGRATIONS`; never edit one that has already shipped.
`PRAGMA user_version` records how many have run, and each entry applies inside a
transaction. `services/__tests__/migrations.test.ts` covers the upgrade path.

## Tooling

- **CodeGraph** — code knowledge graph. Re-index with `codegraph sync`.
- **Codacy** — static analysis, configured in `.codacy/codacy.yaml`.
