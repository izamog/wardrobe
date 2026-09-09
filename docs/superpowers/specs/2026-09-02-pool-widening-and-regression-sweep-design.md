# Pool-Widening Fix and Real-Wardrobe Regression Sweep — Design

## Status

Approved through conversational design review this session (this document is
the write-up of that agreed design, not a first draft awaiting sign-off).

## Problem

### A. A valid mid-range item can be invisible to the entire search

`mergedByBandCenters` (`utils/bandedOutfits.ts`) builds the candidate pool
`coreOutfitsForBands` searches by calling `floorAwareCandidates` once per
band, keeping only `MAX_SLOT_CANDIDATES` (6) items per call — half leanest,
half warmest-under-ceiling — then merging the three bands' results. That
constant was sized for a single outfit slot's own search branching cost
(see its doc comment: raising it "needs candidates ranked and trimmed
before generateOutfits is called, not this constant raised"), not for
representing every plausible bottom in a real, ~90-item wardrobe.

Confirmed via direct trace against the user's real wardrobe
(`docs/wardrobe-export.csv`) at 19°C/21kph, filter off: a silk skirt
(weighted warmth 1.8, comfortably inside the day's [1,6] range and a strong
fit for the `warmer` band's own [4.33,6] sub-range once topped up with a
top and shoes) entered **0 of 4,149** generated core outfits. Not because
it was a poor fit — because too many *other* items competed for the fixed
3-item "warmest-under-ceiling" slice, across all three band calls, before
the actual outfit search ever ran. The user experienced this as "why is
this item never even offered," and separately as excess same-band item
repetition and residual over-ceiling fallbacks — both downstream
consequences of fewer valid candidates surviving the crowded pool.

### B. Every fix this session was verified against 1-2 hand-picked temperatures

Every prior fix in this session was checked against a throwaway diagnostic
script, written fresh, run against `docs/wardrobe-export.csv` at one or two
specific temperatures, then deleted. Each fix's own spot-check passed —
but a new issue reliably surfaced at a *different* temperature or filter
state the next time the user tried the app, because the verification
method itself never covered a representative range. The pattern isn't "the
fixes are wrong" — each one was independently correct and unit-tested — it's
that no single verification pass has ever exercised the whole system
against real data across a spread of conditions at once.

## Design

### A. A dedicated, larger pool-widening slice

`floorAwareCandidates` (`utils/outfitCandidatePools.ts`) gains an optional
`slotSize: number = MAX_SLOT_CANDIDATES` parameter, controlling how many
items go into its leanest-half/warmest-half split (currently hardcoded to
`MAX_SLOT_CANDIDATES` internally via `leanFirst`'s own slice). Every
existing caller — `bottomCandidatesFor`'s downstream use in
`outfitGenerator.ts`, `buildSlots`'s Top/Shoes slots — keeps calling it
with no `slotSize` argument, so behavior there is byte-identical to today.

`mergedByBandCenters` passes a new, larger constant —
`BAND_POOL_SLOT_SIZE = 15` — for its own two `floorAwareCandidates` calls
(anchor pool, top pool). 15 is chosen to comfortably exceed a personal
wardrobe's typical per-category item count in the 20-40 range while still
being a bounded, fixed cost, not a function of wardrobe size.

**Why this doesn't reopen the branching-cost concern `MAX_SLOT_CANDIDATES`
guards against:** `coreOutfitsForBands`'s own doc comment already
establishes that this merged pool feeds `generateClosestOutfits` as **one**
search per day (`anchorPool`/`topCandidatesOverride`), not once per band
and not once per DFS branch — the widening this design spec's
"Pool widening" section already accepted as a bounded, one-time cost. A
larger merged pool means that one search's own anchor/top loop iterates
over more candidates once, not that the cost multiplies anywhere else in
the tree. This is confirmed empirically, not assumed — see Testing below.

### B. A permanent real-wardrobe regression sweep

A new test file, `utils/__tests__/realWardrobeRegression.test.ts`, reads
`docs/wardrobe-export.csv` directly (the same parsing logic this session's
throwaway scripts used repeatedly — CRLF-aware line splitting, the exact
`COLUMNS` order `wardrobeExport.ts` writes, synthesized `id: csv-<row>`)
and calls `outfitsFor` across a representative sweep:

- **Temperatures:** -10, -5, 0, 5, 10, 15, 17, 19, 20, 21, 25, 29, 35 (°C
  felt) — chosen to span the full `warmthFloor`/`warmthCeiling` curve's
  interesting regions (deep cold, the 20°C neutral point from both sides,
  the exact boundary, and hot), including the two temperatures this
  session's own investigation used.
- **Wind:** 0 and 21 kph — a calm day and the windy day this session's
  wind-logic explanation discussed.
- **Filter:** `workAppropriateOnly` both `true` and `false`.

That's 13 × 2 × 2 = 52 scenarios, each a single `outfitsFor` call — cheap
individually, bounded in total (see Testing's performance guard).

For each scenario, assert:

1. **`shown.length` never falls short of what the wardrobe can actually
   support.** Not a flat `=== 6` (a genuinely scarce scenario can
   legitimately fall short, as documented elsewhere this session) — instead,
   the test records every scenario's `shown.length` into a table in its own
   output, and fails any scenario where `shown.length < 6` **and** a valid,
   non-reuse-conflicting alternative can be shown to exist via the same
   diagnostic trace this session used repeatedly (reconstruct `useCounts`
   from the other bands' real picks, check the last band's own topped-up
   list for an unclaimed valid candidate) — i.e. it fails exactly the
   class of case Task 5 in the last plan manually caught, automatically.
2. **No item appears more than once within a single band's own 2 picks**
   unless the same diagnostic trace proves zero non-conflicting fresh
   alternative existed for that band at that scenario.
3. **Pool-visibility invariant — the one that catches today's bug
   directly:** for every item in the wardrobe whose own weighted
   contribution alone is `<=` the scenario's `warmthCeiling`, assert it
   appears in `coreOutfitsForBands`' output for at least one scenario in
   the *entire* sweep (not necessarily every scenario — an item doesn't
   need to be visible at every temperature, only at temperatures where it
   could plausibly matter). An item that's invisible across the *entire*
   sweep despite fitting under some ceiling in it is exactly the silk-skirt
   bug, generalized.

This test does not assert exact item identities or exact warmth values —
those are legitimately sensitive to wardrobe contents and would make the
suite brittle against future wardrobe edits. It asserts the *structural*
properties (count held, no unexplained repeats, no permanently-invisible
fitting item) that this session's bugs all violated.

## Testing

- Unit tests for `floorAwareCandidates`'s new `slotSize` parameter: default
  omitted behaves identically to today (existing tests unchanged); an
  explicit larger `slotSize` returns proportionally more leanest/warmest
  candidates.
- Unit test for `mergedByBandCenters` confirming it now passes
  `BAND_POOL_SLOT_SIZE` (not `MAX_SLOT_CANDIDATES`) to its
  `floorAwareCandidates` calls.
- A performance regression test (mirroring the existing one in
  `bandedOutfits.test.ts`) confirming `selectBandedOutfits` still completes
  within a generous wall-clock bound with the widened pool, against a
  synthetic wardrobe shaped like a large real closet (~90+ items across all
  categories) — empirically verified, not assumed, matching this session's
  established discipline for anything touching pool-widening cost.
- Real-wardrobe verification (both the pool fix and confirming the new
  sweep test itself catches the silk-skirt case before the fix and passes
  after): run the sweep test against the *current* (pre-fix)
  `mergedByBandCenters` first, confirm it fails on the pool-visibility
  invariant for the silk skirt specifically, then apply the fix and confirm
  it passes — proving the new regression test is actually load-bearing for
  the bug it's meant to catch, not just passing by construction.

## Out of scope

- Making `BAND_POOL_SLOT_SIZE` a function of wardrobe size (adaptive
  sizing) — a fixed, generously-sized constant is simpler and sufficient
  for a personal wardrobe; revisit only if a much larger wardrobe size
  becomes a real scenario.
- Expanding the regression sweep's temperature/wind grid further, or
  adding additional invariants beyond the three listed — this set
  specifically targets the bug classes actually found this session; add
  more only when a new class of real-wardrobe bug is found that this sweep
  wouldn't have caught.
- Any further tier-fallthrough restructuring in `fillBandTiered` (already
  explicitly out of scope per the prior plan's own spec) — this design
  does not touch reuse-tracking or ranking logic at all, only pool
  construction and verification.
