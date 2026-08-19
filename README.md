# wardrobe

Local-first iOS app for organising clothing, recording which items go together,
and building weather-appropriate outfits from those rules.

The app lives in `wardrobe-app/`. Everything is on-device; there is no server.

## Status

**Phase 3 — voice ingestion.** Adding an item is: take a photo, then hold the
mic button at the bottom of the same screen and describe the piece while
looking at it. Attributes appear one at a time as cards with accept/reject;
rejecting opens an editor for that field. Attributes the model did not hear get
no card and keep their defaults.

Photos are auto-cropped to the garment. Item Details is read-only until you tap
the edit icon in the header.

Colour is now recorded — up to two per garment, enforced by the schema rather
than by app code.

Background removal is still deferred to the development build Phase 6
requires; see below. Still stubs: **Today** (Phase 5) and **Calendar** (Phase 6).

### Voice setup

Copy `wardrobe-app/.env.example` to `.env` and add an OpenAI key. Without one
the app skips the voice step entirely and everything else works.

Audio leaves the device to be transcribed and the recording is deleted
immediately afterwards, on every path including failure. `EXPO_PUBLIC_` values
are inlined into the JS bundle in plain text, which is fine for a personal
build and **not** fine for TestFlight — distribution needs the call moved
behind a server.

Roughly £0.002 per item, with no monthly cap.

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
under Jest against `node:sqlite` with no native runtime. `services/
itemActions.ts` takes its database runner as a parameter for the same reason —
importing `withDb` would make its ordering rules untestable.

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

### Photos and cropping

A picked photo is sent to a vision model, which returns the garment's bounding
box and a guess at its category. `utils/cropGeometry.ts` turns that box into a
crop rectangle — padded for leeway, centred on the piece, and grown towards 3:4
**only as far as the image allows**. A wide garment keeps its own shape rather
than losing its ends: cropping is the one step that destroys pixels, and the
closet tile letterboxes with `contain` instead, so nothing is ever cut off in
the grid.

Detection is an optimisation, never a requirement. No key, no network or a
nonsense answer all fall back to a centred crop, and the photo is still saved.

### Colour

Two columns, `primaryColor` and `secondaryColor`, not a list. That puts "at
most two colours" in the schema instead of in app code and keeps colour
indexable for Phase 5. Four CHECK constraints carry the rules: each value is in
the vocabulary or empty, no second without a first, never the same colour
twice, and `Multi` never appears alongside anything — in either column.

`utils/colors.ts`'s `toColorPair` applies exactly those rules, so neither the
picker nor a spoken description can produce a pair SQLite would reject.

### Voice ingestion

`utils/proposals.ts` is the boundary between the model and the database. A
language model is an input source, not an authority: structured output
constrains the shape of a reply and nothing about the values in it, so every
field is re-checked there against the same vocabularies the CHECK constraints
enforce. Anything invalid becomes "not heard" rather than reaching SQLite.

Facts and estimates are treated differently on purpose. A bad brand or price is
discarded; an out-of-range warmth is clamped, because a model answering 12 for
a parka has still said something true.

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
`inferredWarmth` and `inferredWind` are on a 0-10 scale, shared with the
thermal targets Phase 5 derives from the forecast — an outfit qualifies when
its pieces' scores sum to at least the target, so both sides must use the same
scale. They are generated by the app from Phase 3 onwards rather than asked of
the user, and are editable on Item Details only so a wrong value can be
corrected while that generation is being built.

### Changing the schema

Append a new entry to `MIGRATIONS`; never edit one that has already shipped.
`PRAGMA user_version` records how many have run, and each entry applies inside a
transaction. `services/__tests__/migrations.test.ts` covers the upgrade path.

## Tooling

- **CodeGraph** — code knowledge graph. Re-index with `codegraph sync`.
- **Codacy** — static analysis, configured in `.codacy/codacy.yaml`.
