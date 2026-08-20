# wardrobe

Local-first iOS app (Expo / React Native) for organising clothing, recording
pairwise MATCH/DISMATCH compatibility between items, and generating
weather-appropriate outfits. The app itself lives in `wardrobe-app/`.

## Boundaries

Build/scope constraints — what not to do, and why — live in
`wardrobe-app/AGENTS.md`. Read it before touching anything under
`wardrobe-app/`.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `izamog/wardrobe`, managed with the `gh` CLI.
See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root.
See `docs/agents/domain.md`.
