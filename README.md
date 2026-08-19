# wardrobe

Local-first iOS app for organising clothing, recording which items go together,
and building weather-appropriate outfits from those rules.

The app lives in `wardrobe-app/`. Everything is on-device; there is no server.

## Status

**Phase 1 — foundations.** Data model, SQLite schema and migration system are in
place. There is no user interface yet: `App.tsx` runs the migrations on launch
and renders a status card. Adding items, recording compatibility and generating
outfits all arrive in Phase 2.

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

## Data model

Three tables, defined in `wardrobe-app/services/migrations.ts`:

- **ClothingItems** — one row per garment, with cost in minor units and CHECK
  constraints mirroring the unions in `types/wardrobe.ts`.
- **Item_Compatibility** — a MATCH/DISMATCH verdict per pair of items. Pairs are
  stored once in canonical id order (`item_a_id < item_b_id`), so a pair cannot
  hold two contradictory verdicts, and an item cannot pair with itself. Sort the
  two ids before every insert and query.
- **Outfit_Logs** — what was worn on a given date.

### Changing the schema

Append a new entry to `MIGRATIONS`; never edit one that has already shipped.
`PRAGMA user_version` records how many have run, and each entry applies inside a
transaction. `services/__tests__/migrations.test.ts` covers the upgrade path.

## Tooling

- **CodeGraph** — code knowledge graph. Re-index with `codegraph sync`.
- **Codacy** — static analysis, configured in `.codacy/codacy.yaml`.
