# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before
writing any code. Expo's APIs move between SDKs and the unversioned docs will
describe a newer one than this project uses.

## Do not raise the Expo SDK

This project is pinned to **SDK 54** deliberately. The App Store build of Expo
Go is 54.0.2 and refuses to open a project built against a newer SDK — an
SDK 57 scaffold failed exactly this way and had to be walked back.

Raising the SDK means abandoning Expo Go for a custom development build, which
needs Xcode or a paid Apple Developer account. Don't run `expo upgrade`, and
don't "fix" the pinned versions in `package.json`, without that being the
explicit goal.

Install native dependencies with `npx expo install <pkg>`, never plain
`npm install` — the latter resolves versions the SDK doesn't expect.

## Checks

```bash
npm test          # jest
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

## Schema changes

The SQLite schema is versioned through `PRAGMA user_version`. Append a new
entry to `MIGRATIONS` in `services/migrations.ts`; never edit one that has
already shipped. See the repo root `README.md`.
