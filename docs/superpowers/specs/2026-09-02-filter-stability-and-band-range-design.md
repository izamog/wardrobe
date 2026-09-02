# Filter-Toggle Stability and Band-Range Clustering — Design

## Status

Approved through conversational design review this session (this document is
the write-up of that agreed design, not a first draft awaiting sign-off).

## Problem

### A. Toggling "work appropriate" discards outfits that were already valid

`outfitsFor` (`contexts/TodayDataContext.tsx`) is a pure function with no
memory between calls. `TodayScreen.tsx`'s `outfits` `useMemo` calls it fresh
every time `workAppropriateOnly` changes, which reruns `selectBandedOutfits`
from scratch against the smaller, `filterWorkAppropriate`-narrowed candidate
pool — even for outfits that were already built entirely from work-appropriate
items. The user sees the whole 6-outfit set churn on a toggle that should, in
the ideal case, only ever *remove* options it can no longer support, never
silently swap out ones that were already fine.

Confirmed not to be a contributor to Problem B below (the same Bag-scarcity
math applies whether the list is recomputed fresh or preserved), but a real,
independent UX defect worth fixing on its own.

### B. A band's picks can cluster near the wrong edge of the day's range

Reported and traced against the real wardrobe this session, at multiple
temperatures: `warmer` (or `cooler`) can end up showing outfits clustered
near the *opposite* edge of the day's valid range from its own target — e.g.
at 17°C/19kph with a required whole-day warmth range of 4–9 (`warmer`'s own
band sub-range centered around 8.2), `warmer` showed two outfits at 4.8,
right at the bottom of the *day's* range, not its own.

Root cause: `rankNow`'s sort order is `(meetsTarget desc, freshness asc,
distance-to-band.center asc)`. Tier 1 of `selectBandedOutfits`'s fill loop
(`valid + fresh`) accepts *any* fresh, valid candidate over reusing one much
closer to the band's own center — freshness always wins over distance, with
no bound on how far "fresh" is allowed to be from target. When the genuinely
close-to-target items are already claimed by an earlier-processed band (here,
`median`, which goes first), `warmer`'s own tier 1 settles for whatever fresh
option exists anywhere in the day's valid range, however far from its own
target that is — even though tier 2 (valid + reused) would have offered a
far closer match.

Confirmed via the real wardrobe: 40 valid candidates existed at warmth 7+
(close to `warmer`'s own center of 8.2), all reuse-blocked by `median`'s
picks; the fresh alternative at 4.8 was accepted anyway because tier 1 never
compares its own distance-to-center against what tier 2 could offer.

## Design

### A. `alreadyClaimed` — preserve valid outfits across a filter toggle

**In the user's own words, confirmed as the exact intended behavior:** "When
no filter toggles are applied, the user sees the 6 best outfits according to
just right, warmer, and colder. When the filter toggles are applied, the app
holds onto the outfits it already generated which matched the requirements,
and then finds the next best outfits for just right, warmer, and colder,
which are in line with the filter toggle requirements."

**`selectBandedOutfits`** (`utils/bandedOutfits.ts`) gains a new optional
parameter, `alreadyClaimed?: readonly ScoredOutfit[]` — outfits from a prior
call that the caller wants kept as-is for their tagged band slots (each
`ScoredOutfit` already carries a `band` tag from a prior `selectBandedOutfits`
call). Before the band loop runs:

1. Seed the reuse tracker (`createReuseTracker`'s `useCounts`/`firstUse`) by
   `record()`-ing every item in every `alreadyClaimed` outfit — so a band
   still being searched correctly treats those items as already used
   (respecting the `UNTRACKED_CATEGORIES` exemption already in place: a
   claimed outfit's Bag/Belt/Scarf never blocks anything).
2. Group `alreadyClaimed` by its own `band` tag. For each band in `order`: if
   2 already-claimed outfits are tagged to it, use them directly as that
   band's `results` entries and skip `fillBandTiered` for it entirely. If
   fewer than 2 (0 or 1), run `fillBandTiered` as today to fill the
   remaining slot(s), and prepend whatever was already claimed for that band
   ahead of the newly-found ones.

**`outfitsFor`** (`contexts/TodayDataContext.tsx`) gains a matching optional
parameter, `previous: TodayOutfits | null = null`. When `workAppropriateOnly`
is `true` and `previous` is given: filter `previous.shown` down to outfits
where every item has `isWorkAppropriate === true`, pass the survivors as
`alreadyClaimed` to `selectBandedOutfits`. When `previous` is omitted or
`workAppropriateOnly` is `false`, behavior is unchanged from today (a cold
call, no preservation) — so this parameter is purely additive and every
existing caller keeps working with no changes.

**`TodayScreen.tsx`** needs the last-computed outfits available to pass
forward. A `useRef<TodayOutfits | null>` holds the most recent result,
updated after every computation. The `outfits` `useMemo` passes it as
`previous` to `outfitsFor` **only on the specific transition where
`workAppropriateOnly` is what changed and `feltTempC`/`windSpeedKph` did
not** — determined by comparing the current effective temperature/wind
against what produced the ref's stored value. Sliding the troubleshooting
temperature or wind sliders never passes `previous`: those change
`warmthFloor`/`warmthCeiling`/the bands themselves, so an old outfit's
validity and even which band it belongs to can genuinely differ, and
preserving across that transition would risk showing an outfit under bounds
that no longer describe it.

### B. `inBand` — keep a band's picks within its own sub-range when possible

`rankNow`'s sort comparator (`utils/bandedOutfits.ts`) gains a new tier,
inserted between `meetsTarget` and `freshness`:

```
function inBand(outfit: ScoredOutfit, band: WarmthBand): boolean {
  return outfit.warmth >= band.min && outfit.warmth <= band.max;
}
```

New sort order: `(meetsTarget desc, inBand desc, freshness asc,
distance-to-center asc)`.

This means: among valid (`meetsTarget: true`) candidates, one genuinely
within *this specific band's* own `[min, max]` sub-range always outranks
one outside it, regardless of freshness. Freshness only breaks ties within
the same `inBand` bucket — so the original freshness-preference intent
(spread reuse across items) is fully preserved *within* a band's own
legitimate range, and only stops overriding distance once a candidate falls
outside that range entirely.

Concretely, for the reported 17°C case: within tier 1's own ranked list
(`valid + fresh`), the new `inBand` tier means an in-band fresh candidate is
always found before an out-of-band one — so if `warmer` has *any* fresh,
in-band option, it now wins outright, which it did not before. But tier 1's
own fallthrough to tier 2 (reuse) is unchanged: if tier 1 has *no* in-band
candidates at all (only out-of-band fresh ones), it still fills from those
rather than moving to tier 2 early. That gap is the case this design
accepts, not fixes — see "Known limitation" below.

**Known limitation, accepted:** this design improves ranking *within* a
tier, not the tier-fallthrough logic itself (`fillBandTiered`'s "try tier 1
across all sources, then tier 2, etc." structure is unchanged). If tier 1
has *zero* in-band candidates but *some* out-of-band fresh ones, it will
still pick the out-of-band fresh ones rather than falling through to tier 2
early to find an in-band reused one. Fully solving that would mean
restructuring the tier order itself (e.g. interleaving "in-band + reused"
ahead of "out-of-band + fresh"), which is a larger change with more subtle
tradeoffs (how much should reuse cost be traded against staying in-band?)
better left for a follow-up if this narrower fix proves insufficient.
Real-wardrobe re-verification (below) determines whether this narrower fix
is enough in practice.

## Testing

**Feature A:**
- Unit tests on `selectBandedOutfits` with `alreadyClaimed`: a band fully
  supplied (2 outfits) skips its own search entirely; a band partially
  supplied (1 outfit) fills only the remaining slot, respecting reuse
  against the claimed outfit's tracked items; an empty/omitted
  `alreadyClaimed` behaves identically to today (regression guard).
- Unit tests on `outfitsFor` with `previous`: a `previous` result whose
  outfits are all still work-appropriate is fully preserved (same outfit
  objects, not just same content) when `workAppropriateOnly` is toggled on;
  a `previous` result with some non-work-appropriate outfits only preserves
  the survivors and fills the rest; `previous` is ignored when
  `workAppropriateOnly` is `false`.
- No test asserts on `TodayScreen.tsx`'s `useRef`/`useMemo` wiring directly
  (component-level, not unit-testable off-device per this repo's own
  convention — see `AGENTS.md`); manual verification only, per the
  Verification section below.

**Feature B:**
- Unit tests on `rankNow`: a candidate within the band's own `[min, max]`
  outranks a fresh-but-out-of-band one even when the out-of-band one has a
  lower freshness penalty; freshness still breaks ties between two
  otherwise-equal in-band candidates (regression guard against the
  freshness tier being deleted rather than reordered).
- Fixture convention carried forward from earlier this session: no
  "identical apart from id" items in a zero-warmth-weight category:
  distinct warmth values throughout.

**Both — real-wardrobe verification (mandatory, not optional):** re-run the
17°C/19kph/work-appropriate-on and 19°C/19kph scenarios from this session's
own investigation against `docs/wardrobe-export.csv`, confirming: (a)
`warmer`'s picks move meaningfully closer to its own band center than
4.8/2.45 (the pre-fix values), even if not perfectly at target given the
"known limitation" above; (b) total `shown.length` does not regress from 6;
(c) toggling `workAppropriateOnly` on and off at a fixed temperature no
longer swaps out outfits that were already fully work-appropriate.

## Out of scope

- Fully restructuring `fillBandTiered`'s tier order to interleave
  "in-band + reused" ahead of "out-of-band + fresh" (see Feature B's Known
  Limitation) — only pursued as a follow-up if real-wardrobe verification
  shows the narrower `inBand`-in-rankNow fix is insufficient.
- Preserving outfits across a troubleshooting temperature/wind slider change
  — explicitly excluded per Feature A's own scope boundary; only the
  work-appropriate toggle preserves.
- The still-separately-tracked Outerwear/Bag/Belt/Scarf reuse work already
  shipped this session (`aa25ff8`, `c5eb721`) — this spec builds on top of
  that, does not revisit it.
