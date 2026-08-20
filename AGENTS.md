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

See `docs/agents/domain.md` for how domain documentation is consumed —
this is a single-context repo, so that means a root-level glossary
file and an architecture-decisions directory once they exist. Both are
created lazily; their absence is expected, not a gap to fill.
