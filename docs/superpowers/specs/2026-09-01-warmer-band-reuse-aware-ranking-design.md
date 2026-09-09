# Warmer-Band Reuse-Aware Ranking — Design

## Status

Approved through conversational design review (this document is the write-up
of that agreed design, not a first draft awaiting sign-off).

## Problem

`selectBandedOutfits` (`utils/bandedOutfits.ts`) fills each of the three
warmth bands (median, cooler, warmer) by ranking every candidate core outfit
by closeness to that band's own target warmth (with a meetsTarget-first
tiebreak already fixed earlier this session). The ranking has no awareness
of what other bands have already claimed.

In practice, one specific Top+Outerwear pairing (the single warmest sweater
and the single warmest coat, say) numerically beats almost every other
pairing for hitting a high warmth target, regardless of which bottom it's
paired with. The ranked list isn't "distinct outfit ideas ranked by fit" —
it's that one pairing repeated with a different bottom and a different
shoe/belt/bag thousands of times over. Median and cooler each legitimately
claim two uses of it (the global max-2-reuse rule). By the time the last
band's turn comes, its own top-ranked candidates are *still* built around
that same maxed-out pairing, so they're all rejected by the reuse rule, and
the band falls back to an invalid (region-floor-failing) outfit — even
though the wardrobe has other Tops/Outerwear that would have worked, buried
far down the ranked list behind thousands of near-duplicates of the
maxed-out pairing.

Confirmed against the user's real exported wardrobe (5°C): "warmer" showed
a bare-legged mini-skirt + tights combo failing its own leg-region floor,
while a valid trousers-based alternative existed in the wardrobe but was
never reached — pickUpTo had to walk through ~26,000 near-duplicate
candidates before finding a fresh Top/Outerwear pairing.

Two consequences: correctness (the band that's picked last is structurally
disadvantaged, regardless of what the closet actually contains) and
performance (tens of thousands of candidates checked for one band on a
real, non-huge wardrobe — the same class of cost that caused an earlier,
separately-fixed on-device freeze this session).

### Rejected fix

Deduplicating the raw core-outfit list to one entry per (Top+Bottom+Dress+
Outerwear) combo (reusing `coreComboKey` from `utils/outfitDiversity.ts`)
fixes the flooding, but is too blunt: it also discards every accessory
variant of a combo, including ones that would let a maxed-out Top/Outerwear
pairing fall back to a different Shoes/Bag pairing instead of failing
outright. Verified against the same real wardrobe data: it did not fix
warmer band's invalidity, and dropped total shown outfits from 6 to 3.
Reverted.

## Design

### 1. Band order becomes temperature-dependent

Today, pick order is the fixed sequence `median → cooler → warmer` — the
last band in that sequence is always the one structurally stuck with
whatever's left over once the earlier two have claimed the wardrobe's best
combinations, regardless of which band that structurally penalizes on any
given day.

New rule: median always goes first. Which of cooler/warmer goes *last*
(and is therefore the one more likely to fall back to a closest-available
result on a constrained wardrobe) depends on today's `warmthFloor`:

- `warmthFloor === 0` (at or above the 20°C neutral point — see
  `WARMTH_NEUTRAL_TEMP_C` in `utils/thermal.ts`) → order is
  `['median', 'cooler', 'warmer']`, warmer last.
- `warmthFloor > 0` (below 20°C) → order is
  `['median', 'warmer', 'cooler']`, cooler last.

**Ruling (confirmed in review):** `warmthFloor` is the hot/cold signal, not
a separately-threaded `feltTempC` — it is mathematically exact for the
">20°C / <20°C" rule (`warmthFloor(feltTempC) === 0` exactly when
`feltTempC >= WARMTH_NEUTRAL_TEMP_C`), and using it avoids widening
`selectBandedOutfits`'s parameter list. Exactly 20°C falls on the warm side
(warmer done last) — confirmed acceptable.

Intent, in the user's own words: prioritise cool outfits in summer (so
cooler gets first pick on hot days, warmer can be the one that settles for
leftovers) and warm outfits in winter (so warmer gets first pick on cold
days, cooler settles for leftovers).

### 2. Reuse-aware ranking, computed live per band's turn

Each band's ranking gains a tier ahead of "closeness to center" (itself
already behind the existing meetsTarget-first tier): prefer a candidate
whose tracked items (see `trackedItemIds` — everything except Tights, per
the existing reuse-tracking rule) are **not already in use** by an earlier
band's picks, over one that reuses something already claimed, even when the
reusing candidate would otherwise rank numerically closer to the band's own
target.

Concretely, a candidate's "freshness penalty" is the count of its own
tracked items with `useCounts.get(id) >= 1` (already used at least once,
by any band so far) — 0 (fully fresh) is best. Sort order becomes:

1. `meetsTarget` (true before false) — existing.
2. Freshness penalty (lower first) — new.
3. Distance to `band.center` (closer first) — existing, now the final
   tiebreak instead of the primary sort key.

Because band order is now dynamic and this ranking depends on what's
*already been claimed*, it can no longer be computed once, up front, for
all three bands in parallel (today's structure). It has to be computed —
or at least re-sorted — at the moment each band takes its turn, using
whatever `useCounts` state exists at that point. This applies uniformly to
a band's own primary pick *and* to the adjacent-band borrowing fallback:
when band X borrows from band Y, it draws from Y's own live, freshness-
aware ranking too, not a stale, pre-computed one — so even a borrowed
outfit prefers not to double down on an already-maxed-out pairing.

### 3. Keeping this bounded (performance)

`topUpToward` (adding Scarf/Tights to close a warmth gap) is the expensive
part of this pipeline — it doesn't depend on what other bands have
claimed, only on which band's target it's aimed at. That stays exactly as
it is today: computed once per band, three total passes over the core
list, no regression.

What changes is *re-sorting* an already-topped-up array fresh each time a
band is about to pick, whether as the primary band or as a donor being
borrowed from. A re-sort (a cheap comparator: a target-fixed meetsTarget
flag, a `useCounts` map lookup, a distance subtraction) is far cheaper than
re-running `topUpToward` across the whole core list again. Worst case, this
adds up to ~6 extra re-sorts (3 bands × up to 2 donor lookups each) on top
of the 3 unchanged `topUpToward` passes — bounded, and empirically
verified (not just assumed) as part of testing.

## Testing

Lessons from this session's own test-writing, applied up front this time:

- Test wardrobes must not use items "identical apart from id" within a
  zero-warmth-weight category (Shoes, Bag, Belt) — this either collapses
  deterministically to always picking the same one, or becomes dependent
  on the random fair-tiebreak shuffle used for genuine ties. New tests
  give every item a distinct (even if scoring-irrelevant) warmth value.
- The mixed valid/invalid case is tested via deterministic scarcity (a
  fixed, small number of region-floor-passing items vs. failing ones),
  never via "the ceiling happens to create a mix" (sensitive to random
  tie-breaking, previously flaky).
- Re-run against the user's real exported wardrobe CSV as an explicit
  verification step, at both a cold (5°C) and a hot (25°C+) temperature,
  confirming: (a) the band that goes last on that day now still finds a
  valid outfit where one exists in the wardrobe, and (b) total shown
  outfit count does not regress versus the already-shipped
  meetsTarget-priority fix (the dedup attempt's exact failure mode).

New unit test cases:
- Band order flips correctly above/below `WARMTH_NEUTRAL_TEMP_C`
  (`warmthFloor === 0` vs `> 0`), including the exactly-20°C boundary.
- A band prefers an unused Top/Outerwear pairing over a numerically
  closer-to-center one that's already claimed by an earlier band.
- Existing max-2-reuse and adjacent-band-borrowing tests still pass under
  the new dynamic order and live re-ranking.
- A rough performance sanity check on a larger synthetic wardrobe,
  asserting completion within a reasonable bound — not just "doesn't
  crash" — as a regression guard for the flooding class of bug.

## Out of scope

- Redesigning `generateOutfitsWithItem` or any other consumer of the
  non-banded search pipeline (same fence as the original banding work).
- A configurable/user-facing setting for band priority — the
  hot/cold-driven order is derived automatically from `warmthFloor`, not
  exposed as a preference.
- Further reducing `core`'s own raw size (the anchor/top pool widening
  mechanism) — this design addresses the ranking/ordering cost, not the
  candidate-pool-construction cost, which is a separate, already-accepted
  interim mechanism per the original banded-recommendations spec.
