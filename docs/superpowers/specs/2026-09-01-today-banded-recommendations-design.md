# Today: Banded Recommendations & Global Item-Reuse Limit — Design

## Status

Approved through conversational design review (this document is the write-up
of that agreed design, not a first draft awaiting sign-off). Two open scoping
questions were resolved during design and are recorded as rulings below.

## Problem

Today's existing recommendation pipeline (`rankedDiverseOutfits` in
`utils/outfitDiversity.ts`, feeding `outfitsFor` in
`contexts/TodayDataContext.tsx`) has two structural problems even after this
session's earlier fixes:

1. **No deliberate warmth spread.** The search optimizes for one single
   target window and ranks by closeness to it. There is no concept of
   offering a leaner option, a warmer option, and a "just right" option on
   purpose — whatever variety exists is incidental to how the ranked list
   happens to sort.
2. **No true per-item reuse ceiling.** Diversity is enforced via per
   anchor-*group* caps (Bottom/Dress/Outerwear as one group, Top/Bag/Belt/
   Shoes as another) that *escalate* by raising how many times an
   already-winning item may repeat, rather than by ever preferring a
   different, unused item. Reported bug: two functionally-identical pairs of
   trousers exist in the wardrobe; the search shows the same one four times
   because escalation only ever loosens the incumbent's repeat limit — it
   never asks the candidate pool for an alternative.

A contributing root cause to #2: candidate pools (`outfitCandidatePools.ts`)
are trimmed to a small, largely static set (`MAX_SLOT_CANDIDATES = 6`: 3
leanest + 3 warmest + 1 closest-to-floor) *before* the search runs. An item
sitting in the middle of the wardrobe's warmth range for a slot can be
permanently excluded from ever being tried, independent of anything the
selection/escalation logic downstream does — no amount of fixing selection
can recover an item the search never saw.

## Scope

**Today's recommendations only** (`rankedDiverseOutfits` → `outfitsFor` →
`TodayDataContext`). `generateOutfitsWithItem` (the "create outfit around
this item" flow from `ItemDetailsScreen`) and any other consumer of
`generateOutfits`/`generateClosestOutfits` are explicitly **not** touched by
this change — they keep today's existing anchor-cap behavior. Integrating
the banded/global-uniqueness model into `generateOutfitsWithItem` is
explicitly deferred to a future pass, not part of this one. *(Ruling,
confirmed during design review.)*

## Design

### 1. Bounds — unchanged

`warmthFloor`, `warmthCeiling`, `windFloor` come from `utils/thermal.ts`
exactly as today. Nothing about how today's weather is translated into a
target range changes.

### 2. Three warmth bands

Split `[warmthFloor, warmthCeiling]` into three equal-width bands:

- **Median** — the center third. 2 outfits.
- **Cooler** — the bottom third (leanest). 2 outfits.
- **Warmer** — the top third (warmest). 2 outfits.

Every band still enforces the real leg/torso region floors
(`meetsRegionFloors` in `utils/outfitScoring.ts`) against the *real*
`warmthFloor` — bands only steer which valid outfits get preferred, they
never redefine what counts as weather-valid. "Cooler" means "the leanest
outfit that's still fully valid for today," not "under-dressed."

Ranking *within* a band is by closeness to that band's own center point,
not the single global target used today.

Display order in the final 6-outfit list follows band order: median (2),
then cooler (2), then warmer (2). *(Ruling: matches the order the bands were
described in — "the first 2 should be... the next two are... then the final
two.")*

### 3. Region-aware, widenable candidate pools

`floorAwareCandidates` (used for the Bottom/Dress anchor and the Top slot)
changes from ranking against the whole-outfit `warmthFloor` to ranking
against the *region-specific* target for whichever slot it's building:

- Bottom/Dress pool: closeness to `warmthFloor × LEG_WARMTH_FLOOR_FRACTION`
  (the leg target already computed in `outfitScoring.ts`).
- Top pool: closeness to `warmthFloor × TORSO_WARMTH_FLOOR_FRACTION` (the
  torso target).

This requires `floorAwareCandidates` to know which region target applies —
it currently takes a single `warmthFloor` number with no region context.
Plumbing that through (or splitting into two thin wrapper calls, one per
region, sharing the core split/merge logic) is a Task-level implementation
decision, not re-litigated here.

The pool is no longer a hard, fixed-size ceiling. When selection (step 6)
cannot satisfy the global-uniqueness rule from what's currently in a pool,
it can request the *next*-best excluded candidates for that slot (the
"check item #7" mechanism) before ever falling back to reusing an
already-selected item a 2nd time.

### 4. Core search — Scarf and Tights pulled out

The exhaustive DFS (`generateClosestOutfits` in `utils/outfitGenerator.ts`)
assembles only the **core** garments: Top, Bottom/Dress anchor, Shoes,
Outerwear, Bag, Belt. Cardigan and Base Layer stay in the core search
exactly as today (only Scarf and Tights move out — the user's ask was
specifically about those two). This produces one ranked list of *core*
outfits, each with its own base warmth/wind total, everything else about
`generateClosestOutfits`'s existing scoring and region-floor checks
unchanged.

### 5. Warmth top-up — Scarf and Tights, after banding

Once a core outfit is being placed into a specific band, compare its base
warmth against that band's target center. If short, add a Scarf and/or
Tights to close the gap:

- Try the smallest addition first: Scarf alone, then Tights alone, then
  both — stop as soon as the outfit is within the band's target range.
- Tights added this way count toward the leg-region floor exactly as they
  do today (`legWarmth` already includes the `Tights` category group,
  unweighted) — so a top-up can also be what turns a borderline
  leg-floor-failing core outfit into a passing one, not just a band-center
  nudge.
- Scarf's contribution is whole-outfit only (`WARMTH_REGION_WEIGHT` weights
  it at 0.8 toward `sumWarmth`); it does not count toward either region
  floor directly.
- Existing eligibility rules still apply unchanged: `TIGHTS_UNDER_TROUSERS_
  WARMTH_FLOOR`, `SCARF_PREFERRED_WARMTH_FLOOR`, and the pairing/dismatch
  checks in `utils/pairs.ts` (a scarf or tights that's incompatible with the
  rest of the outfit is not a legal top-up, same as it wouldn't be a legal
  DFS branch today).
- If neither Scarf nor Tights (nor both) can close the gap, the core outfit
  is placed in whichever band its own un-topped-up warmth actually falls
  into — top-up is a nudge, not a guarantee every core outfit reaches its
  intended band.

### 6. Selection — global uniqueness, not per-group caps

Replaces `selectDiverseOutfits`'s current per-anchor-group cap mechanism
entirely, for Today's flow. Walks each band in display order (median,
cooler, warmer), picking 2 outfits per band, against one tracker shared
across all 6 slots and all three bands:

- **Hard ceiling: no item is used more than 2 times, ever**, across the
  whole 6-outfit set. Nothing escalates or relaxes this ceiling — pool
  widening (step 3) is what's tried first when the strict rule can't be
  met from the current pool.
- **If an item is being used for its 2nd time**, the specific outfit that
  used it the 1st time must share **no other item** with the candidate —
  checked independently per reused item, so an outfit that would be a 2nd
  use for two different items simultaneously must clear this check against
  each of those two prior outfits separately.
- Candidates that would violate either rule are skipped in favor of the
  next-ranked candidate in that band; if the band's current pool is
  exhausted, pool-widening (step 3) runs before ever accepting a violation.

### 7. Empty-band fallback (interim behavior, not the real design)

If a band still cannot fill its 2 slots after full pool-widening, it
borrows outfits from an adjacent band rather than leaving slots empty, so
Today still shows 6 outfits. *(Ruling, confirmed during design review —
the real fallback design, including exactly how starved this has to get
before it's acceptable to reuse an item a 3rd time or relax other rules, is
explicitly deferred to a later pass. This is the "still show something
reasonable" placeholder for this implementation only, not the final
answer.)* Borrow order: the band nearer in warmth first (cooler borrows
from median before warmer; warmer borrows from median before cooler;
median borrows from cooler before warmer, arbitrarily, since it's
equidistant from both) — exact tie-break to be finalized during planning
if it turns out to matter for any test fixture.

## Out of scope

- Redesigning `generateOutfitsWithItem` or any other search consumer.
- The real thin-wardrobe fallback (max-2 relaxation, 3rd-use rules, etc.) —
  step 7 is an explicit placeholder only.
- Any change to how `warmthFloor`/`warmthCeiling`/`windFloor` themselves are
  computed from the forecast.

## Self-review

**Placeholder scan:** no TBDs beyond the two explicitly-flagged
implementation-detail decisions in steps 3 and 7, both scoped narrowly and
called out as deferred-to-planning rather than unaddressed.

**Internal consistency:** band ranking (step 2) and the top-up mechanism
(step 5) compose correctly — top-up happens *after* a core outfit is
assigned to a band's ranking pass, so top-up candidates are being evaluated
against the same band-center target the ranking itself uses. Region-floor
checks (already computed per outfit by `generateClosestOutfits`, step 4)
run against the core outfit's totals before top-up, and are re-evaluated
once top-up items are added, so a core outfit that failed the leg floor
before top-up can correctly pass after Tights are added.

**Scope check:** single, focused change to one flow (Today's
recommendations), explicitly fenced off from other search consumers.
