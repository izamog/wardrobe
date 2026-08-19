# wardrobe

Local-first iOS app for organising clothing, recording which items go together,
and building weather-appropriate outfits from those rules.

The app lives in `wardrobe-app/`. Everything is on-device; there is no server.

## Status

**Phase 1.5 — UI shell.** Four-tab navigation over the Phase 1 schema. Working
end to end: add an item through a manual form, browse and filter the closet,
edit or delete an item, and rate pairs as match/dismatch either from an item or
through the Speed Matcher.

Deliberately still stubs, because they depend on later phases: **Today**
(weather forecast and outfit generation, Phase 5) and **Calendar** (outfit logs,
collages and stats, Phase 6). Items carry no photo yet — the camera and
background remover are Phase 2, so tiles show a placeholder.

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

### Categories and layering

`Category` is the garment type (T-Shirt, Shirt, Tank, Sweater, Jacket, Coat,
Bottom, Shoes, Belt, Bag, Scarf). `CategoryGroup` is the outfit slot it fills,
so the four shirt types all group as Top and Jacket and Coat both group as
Outerwear.

Two categories in the same group normally can't appear together — they compete
for one slot. `utils/layering.ts` is the exception: it holds the directional
[inner, outer] rules that let a T-Shirt be worn under a Sweater, and it's what
`getComplementaryCategories` consults before excluding a same-group pair. One
rule needs three garments to state (a Shirt over a T-Shirt can't then go under
a Sweater), so it lives in `isValidLayerStack` rather than the pair table.

`Top` and `Outerwear` remain valid categories so items created before the
specific types existed still load. They carry no layering rules, and
`isValidLayerStack` rejects rather than guesses on them.

### Changing the schema

Append a new entry to `MIGRATIONS`; never edit one that has already shipped.
`PRAGMA user_version` records how many have run, and each entry applies inside a
transaction. `services/__tests__/migrations.test.ts` covers the upgrade path.

## Tooling

- **CodeGraph** — code knowledge graph. Re-index with `codegraph sync`.
- **Codacy** — static analysis, configured in `.codacy/codacy.yaml`.
