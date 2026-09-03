# Outfit Search Performance — Design

## Status

Approved through conversational design review this session (this document
is the write-up of that agreed design, not a first draft awaiting sign-off).

## Problem

The `2026-09-02-pool-widening-and-regression-sweep` plan (commits fbc4073
through ac05fcf) fixed five real outfit-recommendation bugs, all correctly
verified by unit tests, real-CSV tracing, and a permanent 52-scenario
regression sweep. On-device, though, the user reports the Today screen now
takes 10-15 seconds to update after moving the "feels like" temperature
slider, the phone gets hot, and the app sometimes freezes — worst on the
troubleshoot panel.

Root cause, confirmed by direct code reading (not guessed):
`generateClosestOutfits` (`wardrobe-app/utils/outfitGenerator.ts:196-245`),
the search `coreOutfitsForBands` uses as the Today screen's actual
recommendation engine, has its viability check hardcoded to
`() => true` (`outfitGenerator.ts:228`) — no ceiling pruning at all, a
fully exhaustive DFS over every anchor(bottom) × top × optional-slot
skip-or-candidate branch. The function's own doc comment explains this was
safe because pool sizes were bounded by `MAX_SLOT_CANDIDATES` (6) and
because "nothing is pruned... that view exists to show near-misses, not
hide them." Both premises broke, without anyone revisiting the pruning
they depended on: `coreOutfitsForBands` is the *actual* recommendation
path now, not just a troubleshooting view, and this session's own
correctness fix widened its pools from 6 to `BAND_POOL_SLOT_SIZE` (15) —
and the Top slot's pool has no cap at all in this path
(`outfitSlots.ts:264-268`, `topCandidatesOverride`). Estimated leaf count
went from ~885K (pre-fix) to ~8M (post-fix), a ~9x blowup that tracks a
dev-machine benchmark of 700ms-3.5s scaling to 10-15s on a slower phone
JS engine (Hermes), run fully synchronously on the JS thread with no
yield — which is why the symptom is a hard freeze, not just lag.

## Design

Three changes, meant to land together, not as alternatives:

### A. Margin-based ceiling pruning (the actual fix)

**Revised from the original K-best design** after reading exactly how
`generateClosestOutfits`' output is consumed: `coreOutfitsForBands` calls
it with `maxResults: Infinity` (`bandedOutfits.ts:147-172` region), and
every outfit in that full, unsliced result is processed once per band by
`toppedUpForBand` (`bandedOutfits.ts:189-216`) — the breadth of this list
is exactly what this session's pool-widening/jitter/reuse-avoidance work
depends on. A small, fixed "keep the K best" bound would silently defeat
that work. There is no small K to bound against here.

The bound that *is* sound and doesn't depend on any K: `topUpToward`
(`utils/warmthTopUp.ts`) only ever **adds** warmth to an outfit, never
removes it — confirmed by reading its implementation, not assumed. Warmth
is monotonic non-decreasing as items are added (every item's warmth-region
weight is ≥ 0, already relied on by `generateOutfits`' own, separate
ceiling prune, `outfitGenerator.ts:65-67,97-99`). Combined: **any outfit
that already exceeds `warmthCeiling` before top-up is mathematically
guaranteed to still exceed it after top-up** — it can never become a
valid, in-range recommendation no matter what any downstream consumer does
with it. The only thing an over-ceiling outfit is still useful for is the
Today screen's troubleshoot panel, which — confirmed by reading
`TodayScreen.tsx`'s `OutfitDiagnostics` — only ever renders whatever
specific outfit ended up in `shown` after the full `selectBandedOutfits`
pipeline (`rankNow`'s own tiers: `meetsTarget` → `inBand` → reuse →
distance-to-center), never an independent "browse all near-misses"
view. A near-miss the user could ever actually see is already going to be
one of the outfits closest to the bounds, not one buried deep in the
search — so a *generous, but finite* margin above the ceiling is safe to
prune beyond, without needing to reason about an exact K at all.

This is only safe on the *ceiling* side. Floor-side distance can still
improve as later slots add warmth, so a partial outfit under-floor must
never be pruned on that basis — only the ceiling-side bound is
mathematically sound, and it's also where the real branching-factor cost
lives (every optional slot's own "add more warmth" candidates and the wide
Top/anchor pools all push warmth up).

Implementation shape: `generateClosestOutfits` gains a new constant,
`MAX_USEFUL_OVER_CEILING_MARGIN`, and `isViable` stops being a constant
`true` — it becomes: if a partial outfit's warmth already exceeds
`warmthCeiling + MAX_USEFUL_OVER_CEILING_MARGIN`, return `false` for that
branch (ceiling-side only; no equivalent floor-side check). The margin's
exact value is not asserted analytically to be exactly right — it is
**proven empirically** via the exact-output-equivalence test (see
Testing): start generous, run the equivalence sweep, and only accept the
margin once it produces byte-identical output to the current unpruned
search across every existing fixture and the full real-CSV sweep. If any
divergence appears, the margin is too tight — widen it and re-verify,
never accept a divergence as "close enough."

### B. Deferred execution with a loading state (safety net)

**Revised from internal chunking** after weighing the implementation risk:
true mid-DFS chunking would mean converting `generateClosestOutfits`'
recursive search into something interruptible (a generator function or an
explicit continuation) — a large, risky rewrite of the same
correctness-critical code this whole session already spent five commits
getting right, and it's also exactly where risks B2/B3 below (shared
mutable state and re-randomized pool sampling leaking across chunk
boundaries) come from. A simpler design avoids both entirely: **defer the
*start* of the computation by one frame** (`requestAnimationFrame` or
`InteractionManager.runAfterInteractions`, whichever actually lets React
commit a paint first — verify, don't assume) so a loading spinner can
render, then run the search as a single, uninterrupted synchronous call —
no chunk boundaries inside the search at all. This does not reduce total
wall-clock cost on its own — Approach A does that — it only changes the
failure mode from "frozen with no feedback" to "a visible spinner for
however long the (now much cheaper, post-A) computation actually takes."
If on-device benchmarking after A lands still shows an unacceptably long
spinner, true internal chunking becomes a real follow-up; this design
deliberately doesn't build that complexity until the simpler fix is proven
insufficient. Confirmed available without new dependencies: this
Expo-Go-pinned project (per `wardrobe-app/AGENTS.md`, no ejecting, no
native modules) has no web-worker library installed, and
`react-native-reanimated`'s worklets are UI-thread animation primitives,
not appropriate for this kind of business logic.

### C. Quantized-bounds memoization (cheap, additive)

`thermal.ts`'s `warmthFloor`/`warmthCeiling`/`windFloor` already round to
integers via `clamp()` (`thermal.ts:172-174`), and the slider already only
fires one compute per drag via `onSlidingComplete`, not per-tick
(`TodayScreen.tsx:432-433,498-499`) — confirmed, not assumed. So this
doesn't shrink a single drag's own cost; it only makes *revisiting* a
recently-seen temperature (dragging back and forth) instant, for free.

## Risks and mitigations, per approach

The user asked explicitly: for each approach, name 3 concrete ways it
could silently break the outfit-selection correctness this session spent
five commits building and verifying, and how the design guards against
each.

### A. Margin-based ceiling pruning

1. **The margin is too tight and silently truncates real output.** Unlike
   a K-best bound, there's no small natural count to validate against —
   the margin is a single free parameter, and picking it wrong (too small)
   would cut outfits that a downstream consumer (any of the three bands'
   own `toppedUpForBand`/`rankNow` pipeline, not just what's ultimately
   `shown`) still needed to see. *Mitigation:* the margin is never
   asserted correct by reasoning alone — it's proven via **exact-output
   equality**: run the pruned search against the unpruned (current) search
   across the full 52-scenario real-CSV sweep and every existing unit test
   fixture, asserting the *same* set of returned outfits, not "close
   enough." Start with a deliberately generous margin, and only ever
   narrow it later (if at all) behind a fresh equivalence run — never loosen
   the test to accommodate a divergence.
2. **Hiding a near-miss the troubleshoot panel depends on.** Confirmed by
   reading `OutfitDiagnostics` (`TodayScreen.tsx`): it only ever renders
   whatever outfit ended up in `shown` via the full `selectBandedOutfits`
   pipeline, never an independent "browse every near-miss" view — so the
   margin only needs to be generous enough that it never removes an
   outfit that could have ended up as a band's own best-available
   fallback pick. *Mitigation:* the same exact-output-equivalence test
   used for risk 1 covers this directly, since `shown`'s own construction
   depends on the same `core` list this prune modifies — any margin that
   hides a real near-miss that used to reach `shown` would show up as a
   divergence in that test, not require a separate, hand-picked scenario.
3. **Accidentally applying the bound to the floor side too.** The
   mathematical proof only holds for the ceiling (warmth is monotonic
   non-decreasing as items are added; distance-from-floor is not,
   since a later slot can still bring an outfit up to floor). An
   implementation that reused the same bound logic symmetrically for both
   sides would wrongly prune a branch that starts under-floor but would
   have cleared it once a later slot's warmth was added — reintroducing
   exactly the class of "valid outfit invisible to the search" bug this
   whole session fixed. *Mitigation:* the prune check is written and
   tested as ceiling-only, with an inline comment stating why the floor
   side is excluded, plus a dedicated unit test constructing a partial
   outfit that starts under-floor and is only pushed over-floor by a
   later slot, confirming it is still found.

### B. Deferred execution with a loading state

1. **Stale-computation race.** If the user drags the slider again while a
   deferred computation is still pending (queued for next frame) or has
   started running, and nothing tracks which request is "current," an
   earlier, now-stale computation could resolve *after* a newer one and
   overwrite it — showing outfits for a temperature the user already moved
   away from. This isn't an algorithm bug, but it's visibly "the wrong
   outfit for the current setting," the same user-facing symptom as the
   bugs already fixed. *Mitigation:* the same monotonically increasing
   generation/request counter already used elsewhere in this codebase for
   exactly this pattern (`TodayDataContext.tsx`'s `latestRequestId`, used
   by `reload()`/`refreshIfStale()`) — a deferred computation checks its
   own generation against the current one before committing its result via
   `setState`, and discards its output if superseded. Reusing an existing,
   already-battle-tested pattern rather than inventing a new one.
2. **The deferral doesn't actually let React paint before the block
   starts.** `requestAnimationFrame`/`InteractionManager.runAfterInteractions`
   scheduling on React Native's JS thread isn't a hard guarantee — if the
   deferred callback fires before React has actually committed the loading
   state to the screen, the user sees the exact same freeze as before,
   just with extra code that gives a false sense of the problem being
   fixed. *Mitigation:* this specific claim (does the spinner actually
   render before the block starts) can only be confirmed by real on-device
   testing — this environment has no simulator/device access (an existing,
   standing limitation), so the plan explicitly calls out manual
   verification of this exact behavior as a required step before
   considering this approach done, not something to assume works because
   the code compiles and passes unit tests.
3. **A second user interaction during the now-visible loading state races
   the state this screen already carefully sequences.** `TodayScreen.tsx`'s
   `lastComputedRef`/`filterOnlyChange` logic (built earlier this session,
   the filter-toggle-stability fix) depends on knowing exactly what bounds
   the *previous* `outfits` value was computed under. If the user toggles
   `workAppropriateOnly` while a deferred temperature-slider computation is
   still pending, and both end up writing `lastComputedRef`/calling
   `outfitsFor` without respecting each other's in-flight state, the wrong
   `previous` could get passed through — silently breaking the
   filter-stability fix. *Mitigation:* the generation-counter guard from
   risk 1 covers this too, as long as *every* trigger of a fresh
   computation (slider AND filter toggle) shares the same counter and the
   same "only the latest generation may write `lastComputedRef`" rule —
   this needs to be a single, shared mechanism, not one guard for the
   slider and a separate, uncoordinated one for the filter toggle.

### C. Quantized-bounds memoization

1. **Incomplete cache key.** The result depends on more than
   `(floor, ceiling, windFloor, workAppropriateOnly)` — it also depends on
   `wornDaysAgo` (reuse/freshness state, which changes whenever the user
   logs an outfit) and `alreadyClaimed`/`previous` (the filter-toggle-
   stability mechanism built earlier this session). A cache keyed only on
   the thermal bounds could serve a stale result computed under a
   different wear-history or filter-preservation state, silently
   contradicting the filter-stability fix. *Mitigation:* the cache key
   includes a cheap "wear-history version" counter, bumped on every write
   that changes `wornDaysAgo` (an outfit logged), and the `alreadyClaimed`
   set's own identity — not just the thermal bounds — so any state change
   that could affect the result invalidates the cache entry.
2. **Caching a non-deterministic result as if it were pure.** `evenlySampled`
   is intentionally `Math.random()`-driven so no single item is a
   permanent structural blind spot (Task 3d's whole point, proven by the
   regression sweep's own multi-run statistical tests). Caching a jittered
   result and serving it repeatedly freezes one particular random draw in
   place, which could mean a user gets "stuck" not seeing a size-2-bucket
   item for as long as that cache entry survives — quietly defeating the
   probabilistic-inclusion guarantee Task 3d exists to provide.
   *Mitigation:* cache lifetime is deliberately short and small (an
   in-memory LRU of a handful of recent entries, not a persistent store) —
   its only job is making "drag back to a temperature you were just at"
   instant within one interaction session, not guaranteeing long-term
   result stability for a given temperature.
3. **No invalidation on wardrobe mutation.** If the user adds, edits, or
   archives an item while a cache entry for the current temperature bounds
   still exists, and nothing ties the cache to the wardrobe data's own
   freshness, the Today screen could keep serving a cached result that
   recommends an item the user just archived, or omits one they just
   added — a real correctness regression, distinct from but as serious as
   the bugs already fixed. *Mitigation:* the cache is scoped to and
   cleared alongside the same data-loading layer that already re-runs on
   screen focus (`useDbQuery`'s existing re-run-on-focus behavior) — any
   fresh wardrobe/log data invalidates the whole cache, not just the
   entries that obviously changed.

## Testing

- **Exact-output equivalence for the pruning fix (A):** the primary proof.
  Run the pruned search against a checked-out copy of the current
  (unpruned) search across every existing `outfitGenerator.ts`/
  `bandedOutfits.ts` unit test fixture and the full 52-scenario real-CSV
  regression sweep, asserting identical output sets. Any divergence blocks
  the change — it is not an acceptable tradeoff, since it would mean this
  session's own correctness work regressed silently.
- **Margin sensitivity check (A):** re-run the exact-output-equivalence
  test at a couple of different margin values (e.g. the chosen value and
  a substantially larger one) to confirm the output is already stable —
  i.e. that the chosen margin is comfortably past the point where further
  widening stops changing anything, not just barely large enough to pass
  once.
- **Wall-clock benchmark, before/after (A):** reuse this session's own
  established benchmark harness (real CSV wardrobe, scaled 1x-4x) to
  quantify the actual leaf-count/time reduction, not just assert
  "faster" — the existing `selectBandedOutfits performance` regression
  test's bound should be re-validated against the new numbers, tightened
  if the improvement is as large as estimated (~9x).
- **Race-condition test for chunking (B):** a test that starts one
  computation, immediately starts a second with different inputs before
  the first can complete, and asserts only the second's result is ever
  committed.
- **Cache correctness tests (C):** one test per named risk above — a
  stale-wear-history case, a wardrobe-mutation-during-cache-lifetime case,
  and confirmation that two calls with an identical cache key but
  different underlying `Math.random()` draws don't get silently coalesced
  in a way that violates C's own risk #2 mitigation (cache is short-lived,
  not a correctness guarantee).
- **On-device verification:** this environment has no simulator/device
  access (an existing, standing limitation — see project memory
  `wardrobe-verification-limits`). The user will need to manually verify
  the actual on-device wall-clock improvement and the absence of freezing
  once this lands; automated tests can prove correctness and estimate
  cost reduction, but cannot themselves prove the phone stops overheating.

## Out of scope

- Any native module, ejecting from Expo Go, or a real background/worker
  thread — ruled out by this project's explicit Expo Go pin
  (`wardrobe-app/AGENTS.md`).
- Reworking `generateOutfits` (the sibling, already-pruned search used
  elsewhere) — it already prunes correctly and isn't part of this
  regression.
- Any change to pool sizes, ceiling-scaling, or reuse-tiering logic from
  the prior plan — this design explicitly preserves all of that; the fix
  here is purely about not re-exploring work whose outcome is already
  provably determined.
- Expanding the regression sweep's own scenario grid further — the
  existing 52-scenario sweep is reused as-is for equivalence testing, not
  extended.
