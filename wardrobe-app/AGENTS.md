# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before
writing any code. Expo's APIs move between SDKs and the unversioned docs will
describe a newer one than this project uses.

## Do not raise the Expo SDK

This project is pinned to **SDK 57** deliberately, to match the App Store
build of Expo Go, which auto-updates and refuses to open a project built
against an older SDK than it expects — this pin was previously 54 and was
raised here for exactly that reason (Expo Go moved to 57 and could no longer
open the SDK-54 project).

Raising the SDK again means abandoning Expo Go for a custom development
build, which needs Xcode or a paid Apple Developer account, UNLESS Expo Go
itself has since moved past 57 the same way it moved past 54 — check what
version of Expo Go is currently live before assuming a bump is unwanted.
Don't run `expo upgrade`, and don't "fix" the pinned versions in
`package.json`, without that being the explicit goal.

Install native dependencies with `npx expo install <pkg>`, never plain
`npm install` — the latter resolves versions the SDK doesn't expect.

## Checks

```bash
npm test          # jest
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

## Layout

`navigation/` (navigators + param lists), `screens/`, `components/`, `hooks/`,
`services/`, `utils/`.

Only `services/database.ts` imports `expo-sqlite`. Query and mapping code lives
in `services/items.ts` against the structural `ItemsDatabase` interface, and
pure rules live in `utils/` — both are then testable under Jest with
`node:sqlite` and no native runtime. Don't import `expo-sqlite` elsewhere; it
makes the importing module untestable off-device.

Screens read through `hooks/useDbQuery`, which re-runs on focus so a screen
returned to after another screen wrote to the database is not stale.

Adding a directory that contains `className` means adding it to the `content`
globs in `tailwind.config.js`. Miss it and the styles are silently absent — no
error, just an unstyled screen.

## Bottom bars

Any fixed-position bottom action bar (a Save button, a bulk-delete bar, a
day's outfit sheet on Calendar) must use `components/BottomBar.tsx`, never a
screen-local `absolute bottom-0 ... p-4`. Flat padding puts the button flush
against the device edge, under or on top of the home indicator — reported
against LogOutfitScreen's "Save outfit" button. BottomBar pads for
`useSafeAreaInsets().bottom` instead, and that is the fundamental rule for
every future bottom-fixed action, not a per-screen judgement call.

## Photos

The database stores paths **relative** to the document directory. Never store
an absolute `file://` URI: iOS reassigns the app container UUID and the link
dies. Resolve through `utils/imagePaths.ts` (pure, tested) at render time.

`services/images.ts` is the only module allowed to touch the camera, photo
library or filesystem, and it is not unit-testable off-device — anything added
there has to be verified by running the app.

Give every saved photo a new filename; React Native caches by URI, so
overwriting a path leaves the old image on screen.

`services/itemActions.ts` owns anything spanning the database and the disk.
File before row on create, row before file on delete — read the comments there
before changing the order.

## Voice ingestion

Model output is untrusted. Everything a language model returns goes through
`utils/proposals.ts`, which validates each field against the same vocabularies
the CHECK constraints enforce; invalid values become "not heard". Never widen
that boundary to trust a field because structured output "guarantees" it —
structured output guarantees shape, not values.

Recordings are deleted in a `finally` and never written to permanent storage.

The OpenAI key comes from `EXPO_PUBLIC_OPENAI_API_KEY`, which is inlined into
the bundle in plain text. Fine for a personal build; move it behind a server
before any distribution. When it is unset the app skips the voice step.

Any other `EXPO_PUBLIC_*` secret follows the same rule: it is a bundle-time
constant readable by anyone with the build, acceptable only because this app
is currently built and run by nobody but its own developer.
`EXPO_PUBLIC_BACKGROUND_REMOVAL_TOKEN` (services/backgroundRemoval.ts) is the
other instance — it gates a personal LAN/Tailscale-only service, not a
public one. Before any distribution, every `EXPO_PUBLIC_*` secret has to move
behind a server that issues short-lived, per-device credentials instead.

## Categories

`Category` is the garment type; `CATEGORY_GROUP` in `utils/categories.ts` maps
each to the outfit slot it fills. Same-slot categories are excluded from
pairing unless `utils/layering.ts` says one can be worn under the other.

Adding a category means: the union in `types/wardrobe.ts`, `ALL_CATEGORIES`,
`CATEGORY_GROUP` (a total Record, so this one is a compile error if missed),
any layering rules, and a new migration widening the CHECK constraint.

## Schema changes

The SQLite schema is versioned through `PRAGMA user_version`. Append a new
entry to `MIGRATIONS` in `services/migrations.ts`; never edit one that has
already shipped. See the repo root `README.md`.

SQLite cannot alter a CHECK constraint, so widening one means rebuilding the
table. Copy `Item_Compatibility` out and drop it *before* `ClothingItems`:
with foreign keys on, dropping a parent fires the children's ON DELETE CASCADE
and deletes every verdict without erroring. Migration v2 is the worked example.
