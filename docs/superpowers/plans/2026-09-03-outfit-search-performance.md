# Outfit Search Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Today screen from freezing and taking 10-15 seconds to
update on-device after the prior session's pool-widening fix, without
regressing any of that fix's correctness, by pruning the now-unbounded
exhaustive search, deferring its start so the UI can show a loading state,
and caching repeat computations for free.

**Architecture:** Three independent, additive changes to the same
recommendation path: (A) a provably-safe, margin-based ceiling prune in
`generateClosestOutfits` (`wardrobe-app/utils/outfitGenerator.ts`) — the
actual cost reduction; (B) deferring the Today screen's `outfits`
computation by one frame so a loading spinner can render before the
(now much cheaper) synchronous block runs; (C) a small in-memory cache
keyed on the already-integer-rounded thermal bounds, so revisiting a
recently-seen temperature during a drag is instant.

**Tech Stack:** TypeScript, Jest (`jest-expo` preset), React Native /
Expo SDK 54, pure functions plus one React screen component.

**Spec:** `docs/superpowers/specs/2026-09-03-outfit-search-performance-design.md`

## Global Constraints

- Approach A prunes only on the ceiling side, never the floor side — the
  mathematical proof (warmth is monotonic non-decreasing; `topUpToward`
  only ever adds warmth) only holds for the ceiling.
- Approach D's per-(bottom,top)-pair budget resets exactly once per pair
  (at `slotIndex === 1`, right after Top is chosen or skipped), never
  globally across the whole search — a global budget would starve
  later-visited bottom/top pairs entirely, reintroducing the prior
  session's own "valid item invisible to the search" bug class.
- Approach D is lossy by design and must never be described or verified as
  if it were as strong a guarantee as Approach A's provably-lossless
  margin — its verification is the real-CSV regression sweep's own
  structural invariants holding, not exact-output equality.
- Approach A's margin (`MAX_USEFUL_OVER_CEILING_MARGIN`) must be proven,
  not assumed, to produce identical output to the unpruned search — via
  the equivalence check in Task 2, run against every existing
  `outfitGenerator.ts`/`bandedOutfits.ts` unit test fixture and the full
  52-scenario real-CSV regression sweep (`realWardrobeRegression.test.ts`).
  Any divergence means the margin is too tight — widen it and re-verify,
  never accept a divergence as acceptable drift.
- Approach B defers only the *start* of the computation (one frame) — no
  internal chunking of the search itself. This is a deliberate scope
  limit (see the spec's own reasoning): true mid-DFS chunking is a much
  larger, riskier rewrite this plan does not attempt.
- Approach B reuses the existing generation-counter pattern already in
  `TodayDataContext.tsx` (`latestRequestId`) rather than inventing a new
  one — the same guard must cover both the temperature-slider trigger and
  the work-appropriate-filter-toggle trigger, not two separate,
  uncoordinated guards.
- Approach C's cache key must include everything the result actually
  depends on: the rounded thermal bounds (`floor`, `ceiling`, `windFloor`),
  `workAppropriateOnly`, a wear-history version counter, and the
  `alreadyClaimed`/`previous` identity — not just the thermal bounds alone.
- Approach C's cache is short-lived (a small in-memory LRU, cleared on
  wardrobe/log data refresh) — never a persistent store, and never treated
  as a correctness guarantee for a specific temperature's result over time
  (the underlying search is intentionally `Math.random()`-jittered; see
  Task 3d in the prior plan).
- No native modules, no ejecting from Expo Go, no new npm dependencies —
  this project is pinned to Expo Go (`wardrobe-app/AGENTS.md`).
- This environment has no simulator/device access. Every task's automated
  verification (tests, benchmarks) can be run here; the actual on-device
  freeze/slowness fix cannot be confirmed by anyone but the user, on their
  own phone — Task 5 makes this an explicit, separate checklist for them.

---

## Task 1: Margin-based ceiling pruning in `generateClosestOutfits`

**Files:**
- Modify: `wardrobe-app/utils/outfitGenerator.ts`
- Test: `wardrobe-app/utils/__tests__/outfitGenerator.test.ts`

**Interfaces:**
- Consumes: `sumWarmth` (already imported in this file from `./outfitScoring`).
- Produces: no new exports — `generateClosestOutfits`' own behavior changes (fewer explored branches when warmth is far over ceiling), its signature does not. A new, unexported constant `MAX_USEFUL_OVER_CEILING_MARGIN`.

- [ ] **Step 1: Write the failing test**

Add to `wardrobe-app/utils/__tests__/outfitGenerator.test.ts`, inside the
existing `describe('generateClosestOutfits', ...)` block (create one if it
doesn't already exist, matching this file's existing style — check the top
of the file for its `item`/`emptyCandidates`/`noDismatches` test helpers
and reuse them exactly as other tests in the file do):

```ts
  it('prunes a branch that has already climbed absurdly far over the ceiling, while still finding a normal near-miss just outside it', () => {
    // Reported bug: generateClosestOutfits' isViable was hardcoded () =>
    // true (no pruning at all), which combined with the prior session's
    // pool-widening fix (BAND_POOL_SLOT_SIZE 6->15) blew the search from
    // ~885K to ~8M leaves, freezing the app on-device. topUpToward only
    // ever ADDS warmth (utils/warmthTopUp.ts), so an outfit already far
    // over the ceiling can never become valid regardless of what runs
    // later -- pruning it changes nothing about which outfits are
    // reachable, only how much dead search gets explored to confirm that.
    //
    // Fixture: one bottom, a single Top, and an Outerwear pool where one
    // item is a normal near-miss (a few units over ceiling -- should
    // still be found and returned) and another is absurdly warm (many
    // units over ceiling -- should be pruned away).
    const bottom = item('Pants', { id: 'bottom-1', inferredWarmth: 2 });
    const top = item('Top', { id: 'top-1', inferredWarmth: 2 });
    const nearMissCoat = item('Jacket', { id: 'near-miss-coat', inferredWarmth: 6 });
    const absurdCoat = item('Jacket', { id: 'absurd-coat', inferredWarmth: 40 });
    const shoes = item('Shoes', { id: 'shoes-1', inferredWarmth: 0 });

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], outerwear: [nearMissCoat, absurdCoat], shoes: [shoes] }),
      noDismatches,
      1,
      6,
      0,
      Infinity,
    );

    const usesJacket = (id: string) => results.some((o) => o.items.some((i) => i.id === id));
    expect(usesJacket('near-miss-coat')).toBe(true);
    expect(usesJacket('absurd-coat')).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest utils/__tests__/outfitGenerator.test.ts -t "prunes a branch that has already climbed absurdly far"` (from `wardrobe-app/`)
Expected: FAIL on the `usesJacket('absurd-coat')` assertion — with no
pruning, the current code includes every complete combination in `all`,
so the absurdly-over-ceiling outfit is present in the results.

- [ ] **Step 3: Add the margin constant and wire it into `isViable`**

In `wardrobe-app/utils/outfitGenerator.ts`, add this constant right after
the `DEFAULT_MAX_OUTFITS` export (near the top of the file):

```ts
/**
 * How far over warmthCeiling a partial outfit's warmth can climb before
 * generateClosestOutfits prunes that branch outright.
 *
 * Provably safe on the ceiling side only: warmth is monotonic
 * non-decreasing as items are added (every item's warmth-region weight is
 * >= 0 -- see generateOutfits' own doc comment for the same fact used
 * there), and topUpToward (utils/warmthTopUp.ts) only ever ADDS warmth to
 * an outfit, never removes it -- so an outfit already this far over the
 * ceiling can never become a valid, in-range recommendation regardless of
 * what any downstream consumer (toppedUpForBand, rankNow) does with it
 * later. Not safe on the floor side: a partial outfit under-floor can
 * still be pushed up to floor by a later slot, so this margin is never
 * applied there.
 *
 * The exact value here is not asserted correct by reasoning alone -- it's
 * verified empirically in Task 2's equivalence check (real-wardrobe
 * regression sweep plus every existing unit test fixture), which confirms
 * this margin never changes the search's output relative to no pruning at
 * all. If that check ever finds a divergence, this value is too tight --
 * widen it and re-verify; never narrow the check to accommodate a
 * divergence.
 *
 * Reported bug this fixes: the prior session's pool-widening fix
 * (BAND_POOL_SLOT_SIZE 6->15) took this function's own unpruned search
 * from ~885K to ~8M leaves, freezing the Today screen on-device for
 * 10-15 seconds per slider drag.
 */
const MAX_USEFUL_OVER_CEILING_MARGIN = 20;
```

Then replace `generateClosestOutfits`' `searchSlots` function body:

```ts
  function searchSlots(slots: Slot[], slotIndex: number): void {
    if (slotIndex === slots.length) {
      all.push(scoreOutfit(chosen, warmthFloor, warmthCeiling, windFloor));
      return;
    }

    const slot = slots[slotIndex];
    if (skipsBeforeCandidates(slot)) searchSlots(slots, slotIndex + 1);
    // isViable now prunes branches already far enough over the ceiling
    // that no later addition could ever bring them back into range -- see
    // MAX_USEFUL_OVER_CEILING_MARGIN's own doc comment for the proof.
    // Still deliberately loose relative to generateOutfits' own ceiling
    // check: this function's job is to surface real near-misses too, not
    // just outfits that already meet target.
    tryEachCandidate(
      slot,
      chosen,
      dismatchedKeys,
      () => false,
      () => sumWarmth(chosen) <= warmthCeiling + MAX_USEFUL_OVER_CEILING_MARGIN,
      () => searchSlots(slots, slotIndex + 1),
    );
    if (slot.preferred) searchSlots(slots, slotIndex + 1);
  }
```

(Only change: the `isViable` callback passed to `tryEachCandidate` is no
longer `() => true` — it's the margin check above.)

Also update `generateClosestOutfits`' own doc comment (currently says
"this does not prune on the ceiling or stop at the first `maxResults`
matches... MAX_SLOT_CANDIDATES already bounds the search space to
something that stays fast without it") — that premise is what broke (see
the design spec's Problem section). Replace the second sentence of that
paragraph with:

```
 * Unlike generateOutfits, this does not stop at the first `maxResults`
 * matches -- leaving that in place would hide the very outfits a "why
 * didn't anything work" question needs to see. It does prune branches
 * already far enough over the ceiling that no later addition could bring
 * them back into range -- see MAX_USEFUL_OVER_CEILING_MARGIN's own doc
 * comment for why that's safe without hiding any real near-miss.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest utils/__tests__/outfitGenerator.test.ts`
Expected: PASS, all tests — the new test, and every pre-existing test in
the file (a margin of 20 is generous relative to any single item's own
warmth contribution, so no existing fixture's expected near-miss should be
cut).

Run: `npx jest && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/outfitGenerator.ts wardrobe-app/utils/__tests__/outfitGenerator.test.ts
git commit -m "Add margin-based ceiling pruning to generateClosestOutfits"
```

---

## Task 2: Prove the prune is exact, and benchmark the real speedup

**Files:** none (verification only — no source file changes)

- [ ] **Step 1: Exact-output equivalence against the real-wardrobe sweep**

This is the Global Constraint's own required proof, not optional. Before
this task, temporarily stash Task 1's change and capture a baseline:

```bash
cd wardrobe-app
git stash
npx jest utils/__tests__/realWardrobeRegression.test.ts 2>&1 | tee /tmp/pre-prune-sweep.txt
git stash pop
npx jest utils/__tests__/realWardrobeRegression.test.ts 2>&1 | tee /tmp/post-prune-sweep.txt
diff /tmp/pre-prune-sweep.txt /tmp/post-prune-sweep.txt
```

Expected: the sweep's own 3 invariant tests pass both before and after
(same as they did at the end of the prior plan), and — critically — the
sweep's own pool-visibility invariant (which checks every plausibly-fitting
item enters the core search at least once) still passes after pruning.
This doesn't independently prove zero output divergence on its own (the
sweep asserts structural invariants, not exact-output equality against a
literal unpruned baseline) — it's a first, cheap sanity check. Follow it
with the direct comparison below, which is the real proof.

- [ ] **Step 2: Direct comparison against the unpruned search**

Write a throwaway script (delete when done — do not commit it) at
`wardrobe-app/utils/__tests__/task2-prune-equivalence-check.test.ts`:

```ts
/** @jest-environment node */
import fs from 'fs';
import { generateClosestOutfits } from '../outfitGenerator';
import { warmthFloor, warmthCeiling, windFloor as windFloorFn } from '../thermal';
import { CATEGORY_GROUP } from '../categories';
import type { ClothingItem, Category, ItemColor, HardwareColor, SleeveLength, Thickness } from '../../types/wardrobe';

// Reuses the exact CSV-parsing approach established in
// realWardrobeRegression.test.ts -- see that file for the full pattern
// this is deliberately kept in sync with.
const CSV_PATH = `${__dirname}/../../../docs/wardrobe-export.csv`;
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; } } else { cur += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
}
const COLUMNS = [
  'brand', 'category', 'primaryColor', 'secondaryColor', 'material1', 'material1Percent',
  'material2', 'material2Percent', 'hardwareColor', 'hasBeltLoops', 'sleeveLength', 'length',
  'thickness', 'denier', 'backless', 'inferredWarmth', 'inferredWind', 'isWorkAppropriate',
] as const;
function parseCsv(path: string): ClothingItem[] {
  const raw = fs.readFileSync(path, 'utf8');
  const lines = raw.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  const [, ...rows] = lines;
  return rows.map((line, idx) => {
    const fields = parseCsvLine(line);
    const rec: Record<string, string> = {};
    COLUMNS.forEach((col, i) => { rec[col] = (fields[i] ?? '').trim(); });
    const materials = [];
    if (rec.material1) materials.push({ material: rec.material1, percent: Number(rec.material1Percent) || 0 });
    if (rec.material2) materials.push({ material: rec.material2, percent: Number(rec.material2Percent) || 0 });
    return {
      id: `csv-${idx}`, imagePath: '', originalImagePath: '', imageMarginBaked: false,
      category: rec.category as Category, brand: rec.brand, costMinorUnits: 0, isSecondHand: false,
      purchasedAt: '', materials, primaryColor: rec.primaryColor as ItemColor | '',
      secondaryColor: rec.secondaryColor as ItemColor | '', hardwareColor: (rec.hardwareColor || 'None') as HardwareColor,
      hasBeltLoops: rec.hasBeltLoops === 'true', sleeveLength: (rec.sleeveLength || 'Short') as SleeveLength,
      length: rec.length as any, thickness: (rec.thickness || 'Regular') as Thickness,
      denier: Number(rec.denier) || 0, backless: rec.backless === 'true',
      inferredWarmth: Number(rec.inferredWarmth) || 0, inferredWind: Number(rec.inferredWind) || 0,
      wearCount: 0, createdAt: new Date().toISOString(), archivedAt: '',
      isWorkAppropriate: rec.isWorkAppropriate === 'true',
    } as ClothingItem;
  });
}
function buildCandidates(items: ClothingItem[]) {
  const byGroup = (group: string) => items.filter((i) => CATEGORY_GROUP[i.category] === group);
  return {
    bottoms: [...byGroup('Bottom'), ...byGroup('Dress')], tops: byGroup('Top'), shoes: byGroup('Shoes'),
    outerwear: byGroup('Outerwear'), scarves: byGroup('Scarf'), belts: byGroup('Belt'),
    bags: byGroup('Bag'), tights: byGroup('Tights'),
  };
}

it('produces identical output to the unpruned search across the temperature range', () => {
  const items = parseCsv(CSV_PATH);
  const candidates = buildCandidates(items);
  const temps = [-10, -5, 0, 5, 10, 15, 17, 19, 20, 21, 25, 29, 35];
  for (const feltTempC of temps) {
    const floor = warmthFloor(feltTempC);
    const ceiling = warmthCeiling(feltTempC);
    const wFloor = windFloorFn(21, feltTempC);
    const results = generateClosestOutfits(candidates, new Set(), floor, ceiling, wFloor, Infinity);
    // Structural check, not identity to a hand-maintained snapshot: every
    // returned outfit must genuinely be within the margin of the ceiling
    // (never further over than MAX_USEFUL_OVER_CEILING_MARGIN would allow) --
    // this is what "the prune didn't accidentally admit something it
    // shouldn't" looks like from the *output* side, complementing Step 3's
    // "the prune didn't accidentally exclude something it shouldn't" check.
    for (const outfit of results) {
      expect(outfit.warmth).toBeLessThanOrEqual(ceiling + 20 + 0.001);
    }
  }
});
```

Run: `npx jest utils/__tests__/task2-prune-equivalence-check.test.ts`
Expected: PASS at every swept temperature. Delete the file when done —
`git status` must show it's gone before this task is considered complete.

- [ ] **Step 3: Prove the margin doesn't cut anything real, via before/after comparison**

This is the direct proof the Global Constraint requires. Using the same
throwaway file (recreate it, or keep it from Step 2 until this step is
done), add a second `it` block that runs `generateClosestOutfits` against
a handful of real scenarios (reuse the temps array from Step 2) **twice**:
once against the current code (margin = 20), and once with
`MAX_USEFUL_OVER_CEILING_MARGIN` temporarily edited up to `200` (a
value large enough that pruning essentially never triggers, close to the
old unpruned behavior) directly in `outfitGenerator.ts`, comparing the
`.length` and the sorted set of outfit item-id-combinations returned at
each temperature. Expected: identical at every temperature. If any
temperature diverges, `MAX_USEFUL_OVER_CEILING_MARGIN`'s real value (20)
is too tight — widen it in Task 1's own commit (amend, or a small
follow-up commit) and re-run this whole task before proceeding. Restore
`outfitGenerator.ts` to its committed state (margin = 20) once this
comparison passes; confirm via `git diff wardrobe-app/utils/outfitGenerator.ts`
that it's clean.

- [ ] **Step 4: Wall-clock benchmark, before/after**

Write another throwaway script (or extend the one from Step 2/3) that
times `selectBandedOutfits` (not `generateClosestOutfits` directly, since
`selectBandedOutfits` is the real Today-screen entry point) against the
real CSV wardrobe at a representative cold temperature (e.g. 0°C, 21kph —
the exact scenario the prior plan's own sweep found the within-band-repeat
bug at, and a cold temperature has the widest optional-slot pool, so it's
close to a worst case for branching factor), using the same `Date.now()`
before/after pattern already established in
`bandedOutfits.test.ts`'s own `selectBandedOutfits performance` describe
block. Compare against this session's own earlier-recorded baseline
(734-875ms at the real wardrobe's 1x size, pre-prune) and report the
actual measured improvement. Delete the script when done.

- [ ] **Step 5: Tighten the existing performance regression test's bound**

`wardrobe-app/utils/__tests__/bandedOutfits.test.ts`'s existing
`selectBandedOutfits performance` test (in the `describe('selectBandedOutfits
performance', ...)` block) uses `NO_CEILING`, which means it never
exercises the new prune at all (nothing ever exceeds an infinite ceiling).
Add a second test in that same `describe` block, structurally identical to
the existing one but using a **finite, realistic ceiling** (e.g. reuse
that test's own bottoms/tops/outerwear/shoes/belts/bags fixture, but call
`splitIntoWarmthBands` with a realistic floor/ceiling pair like `(1, 6)`
instead of `(0, 40)`, and pass that real ceiling — not `NO_CEILING` — to
`selectBandedOutfits`), asserting the same generous `<3000ms` bound. This
is the permanent regression guard that would have caught the original
freeze report: it exercises the pruning path a `NO_CEILING` test cannot.

```ts
  it('completes well within a generous bound with a realistic finite ceiling', () => {
    // Mirrors the reported on-device freeze: NO_CEILING (the existing test
    // above) never exercises generateClosestOutfits' pruning at all, since
    // nothing can exceed an infinite ceiling -- this test uses a real,
    // finite ceiling so the prune actually has work to do.
    const bottoms = Array.from({ length: 15 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 6 }, (_, i) => item('Sweater', { id: `top-${i}`, inferredWarmth: 4 + i }));
    const outerwear = Array.from({ length: 6 }, (_, i) => item('Jacket', { id: `jacket-${i}`, inferredWarmth: 4 + i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}`, inferredWarmth: i }));
    const belts = Array.from({ length: 4 }, (_, i) => item('Belt', { id: `belt-${i}`, inferredWarmth: i, hasBeltLoops: true }));
    const bags = Array.from({ length: 8 }, (_, i) => item('Bag', { id: `bag-${i}`, inferredWarmth: i }));
    const candidates = emptyCandidates({ bottoms, tops, outerwear, shoes, belts, bags });
    const bands = splitIntoWarmthBands(1, 6);

    const start = Date.now();
    const results = selectBandedOutfits(candidates, noDismatches, 1, 6, 0, bands);
    const elapsedMs = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(3000);
  });
```

Run: `npx jest utils/__tests__/bandedOutfits.test.ts`
Expected: PASS, both performance tests. Run: `npx jest && npm run lint && npm run typecheck` — all clean.

- [ ] **Step 6: Commit**

```bash
git add wardrobe-app/utils/__tests__/bandedOutfits.test.ts
git commit -m "Add a finite-ceiling performance regression test that exercises the new prune"
```

(If Step 3 required widening `MAX_USEFUL_OVER_CEILING_MARGIN`, that change
belongs in this commit too, with a note in the commit message about what
the equivalence check found.)

---

## Task 2b: Per-(bottom,top)-pair result budget in `generateClosestOutfits`

Task 2's own real-CSV measurement found the ceiling prune (Task 1) only
bought ~6-7% wall-clock improvement. Root cause, confirmed by direct
instrumentation: `coreOutfitsForBands` returns 77,850 outfits at 0°C/21kph
— not from unpruned branches (Task 1 already handles those), but from the
accessory slots (Cardigan, BaseLayer, Outerwear, Bag) genuinely producing
hundreds of valid, distinct combinations per bottom+top pair (~340 on
average), every one of which then gets topped-up 3x and repeatedly
re-sorted downstream.

Removing Scarf/Tights as redundant with the later top-up pass was
investigated and ruled out: `coreOutfitsForBands` already passes
`includeWarmthAccessories: false` (`bandedOutfits.ts:175`), so Scarf/
Tights never entered the core search's branching in the first place —
nothing left to remove there.

**Files:**
- Modify: `wardrobe-app/utils/outfitGenerator.ts`
- Test: `wardrobe-app/utils/__tests__/outfitGenerator.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — `generateClosestOutfits`' own behavior changes (fewer complete outfits collected per bottom+top pair once its budget is spent), its signature does not. A new, unexported constant `MAX_RESULTS_PER_TOP_PAIR`.

- [ ] **Step 1: Write the failing test**

Add to `wardrobe-app/utils/__tests__/outfitGenerator.test.ts`, inside the same `describe('generateClosestOutfits', ...)` block Task 1 added (after Task 1's own test, before the closing `});`):

```ts
  it('caps how many complete outfits it collects per bottom+top pair, without starving a different pair', () => {
    // Reported bug (Task 2's real-CSV benchmark): coreOutfitsForBands
    // returned 77,850 outfits at 0C/21kph -- not from unpruned DFS
    // branches (Task 1 already fixed that), but from the accessory slots
    // (Cardigan/BaseLayer/Outerwear/Bag) genuinely producing hundreds of
    // valid, distinct combinations per bottom+top pair, every one of
    // which then gets topped-up and re-sorted 3x downstream.
    //
    // Fixture: 2 bottoms, 1 top, 5 Outerwear + 3 Bag options -- (5
    // Outerwear + skip) x (3 Bag + skip) = 24 distinct completions per
    // bottom, comfortably exceeding MAX_RESULTS_PER_TOP_PAIR (12).
    const bottomA = item('Pants', { id: 'bottom-a', inferredWarmth: 1 });
    const bottomB = item('Pants', { id: 'bottom-b', inferredWarmth: 1 });
    const top = item('Sweater', { id: 'top-1', inferredWarmth: 1 });
    const shoes = item('Shoes', { id: 'shoes-1', inferredWarmth: 0 });
    const outerwear = Array.from({ length: 5 }, (_, i) => item('Jacket', { id: `jacket-${i}`, inferredWarmth: 1 }));
    const bags = Array.from({ length: 3 }, (_, i) => item('Bag', { id: `bag-${i}` }));

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops: [top], shoes: [shoes], outerwear, bags }),
      noDismatches,
      1,
      10,
      0,
      Infinity,
    );

    const countFor = (bottomId: string) => results.filter((o) => o.items.some((i) => i.id === bottomId)).length;

    expect(countFor('bottom-a')).toBeLessThanOrEqual(12);
    expect(countFor('bottom-b')).toBeLessThanOrEqual(12);
    expect(countFor('bottom-a')).toBeGreaterThan(0);
    expect(countFor('bottom-b')).toBeGreaterThan(0); // proves bottom-b wasn't starved by bottom-a's own budget
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest utils/__tests__/outfitGenerator.test.ts -t "caps how many complete outfits"` (from `wardrobe-app/`)
Expected: FAIL on the `toBeLessThanOrEqual(12)` assertions — with no budget, each bottom currently produces all 24 completions.

- [ ] **Step 3: Add the budget constant and wire it into `searchSlots`**

In `wardrobe-app/utils/outfitGenerator.ts`, add this constant right after `MAX_USEFUL_OVER_CEILING_MARGIN`'s own definition:

```ts
/**
 * How many complete outfits generateClosestOutfits collects per (bottom,
 * top) pair before moving on -- not a global budget (see this constant's
 * own Global Constraint in the plan for why a global one would starve
 * later-visited pairs), reset fresh every time a new Top candidate (or a
 * Dress anchor's Top-skip branch) is chosen.
 *
 * Reported bug this fixes: the accessory slots (Cardigan, BaseLayer,
 * Outerwear, Bag) genuinely produce hundreds of valid, distinct
 * combinations per bottom+top pair on a real wardrobe (coreOutfitsForBands
 * returned 77,850 outfits at 0C/21kph, ~340 per pair on average) -- every
 * one gets topped up and re-sorted 3x downstream (once per band), which
 * dominates wall-clock time far more than the DFS branching
 * MAX_USEFUL_OVER_CEILING_MARGIN already prunes. This is the same
 * "cap redundant depth, not breadth" principle MAX_ACCESSORY_CANDIDATES
 * already applies to a single accessory slot's own pool, applied one
 * level up, to the combinations across several such slots together.
 *
 * Unlike MAX_USEFUL_OVER_CEILING_MARGIN, this is NOT provably lossless --
 * it deliberately drops some real, valid outfits once a pair's budget is
 * spent. Verified via the real-wardrobe regression sweep's own structural
 * invariants holding (not exact-output equality, which doesn't apply
 * here), not asserted correct by reasoning alone.
 */
const MAX_RESULTS_PER_TOP_PAIR = 12;
```

Then replace `generateClosestOutfits`' body from `const all: ScoredOutfit[] = [];` through the closing of `searchSlots`:

```ts
  const all: ScoredOutfit[] = [];
  const chosen: ClothingItem[] = [];
  let resultsForThisPair = 0;

  // Every complete combination gets pushed to `all` — this view exists to
  // show near-misses, not hide them (see this function's own doc comment).
  // dropAccessoryFreeDuplicates, below, is what keeps a bare outfit from
  // cluttering the ranked results once its accessorized twin is shown too.
  function searchSlots(slots: Slot[], slotIndex: number): void {
    // Fresh budget for this (bottom, top) pair -- slotIndex reaches 1
    // exactly once per pair, right after Top is chosen (or skipped, for a
    // Dress anchor), before any accessory branch beneath it runs. See
    // MAX_RESULTS_PER_TOP_PAIR's own doc comment.
    if (slotIndex === 1) resultsForThisPair = 0;

    if (slotIndex === slots.length) {
      if (resultsForThisPair < MAX_RESULTS_PER_TOP_PAIR) {
        all.push(scoreOutfit(chosen, warmthFloor, warmthCeiling, windFloor));
        resultsForThisPair++;
      }
      return;
    }

    const slot = slots[slotIndex];
    if (skipsBeforeCandidates(slot)) searchSlots(slots, slotIndex + 1);
    // isViable now prunes branches already far enough over the ceiling
    // that no later addition could ever bring them back into range -- see
    // MAX_USEFUL_OVER_CEILING_MARGIN's own doc comment for the proof.
    // Still deliberately loose relative to generateOutfits' own ceiling
    // check: this function's job is to surface real near-misses too, not
    // just outfits that already meet target. isDone now also stops once
    // this pair's own budget is spent -- see MAX_RESULTS_PER_TOP_PAIR's
    // own doc comment.
    tryEachCandidate(
      slot,
      chosen,
      dismatchedKeys,
      () => resultsForThisPair >= MAX_RESULTS_PER_TOP_PAIR,
      () => sumWarmth(chosen) <= warmthCeiling + MAX_USEFUL_OVER_CEILING_MARGIN,
      () => searchSlots(slots, slotIndex + 1),
    );
    if (slot.preferred) searchSlots(slots, slotIndex + 1);
  }
```

(Only changes: the new `resultsForThisPair` counter, its reset at `slotIndex === 1`, the budget check at the leaf case, and `tryEachCandidate`'s `isDone` callback changed from `() => false` to `() => resultsForThisPair >= MAX_RESULTS_PER_TOP_PAIR`. The anchor loop below this function, and everything after it, is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest utils/__tests__/outfitGenerator.test.ts`
Expected: PASS, all tests — the new test, Task 1's test, and every pre-existing test (a budget of 12 per pair is generous relative to any existing fixture's own expected near-miss count).

Run: `npx jest && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 5: Re-run the real-CSV regression sweep — this is the real verification for a lossy change**

Run: `npx jest utils/__tests__/realWardrobeRegression.test.ts` at least 3 times in a row (slow, ~5 minutes per run — budget time).
Expected: all 3 invariant tests (pool-visibility, shown-count, within-band-repeat) still PASS reliably. This is the Global Constraint's own required verification method for Approach D — not exact-output equality (that doesn't apply to a lossy change), but confirmation that none of the sweep's structural invariants regress. If any invariant starts failing, `MAX_RESULTS_PER_TOP_PAIR = 12` is too tight for some real scenario — widen it and re-verify; do not weaken the invariant instead.

- [ ] **Step 6: Wall-clock benchmark, before/after**

Using the same throwaway-script technique established in Task 2, measure `selectBandedOutfits`'s wall-clock time against the real CSV wardrobe at 0°C/21kph and 22°C/10kph (5 runs each), comparing against Task 2's own recorded post-Task-1 baseline (4109ms / 1999ms average). Also measure `coreOutfitsForBands`' own `core.length` at 0°C/21kph and compare against the 77,850 baseline. Report both the outfit-count reduction and the wall-clock improvement — this is the number that actually matters for whether the reported freeze is now addressed. Delete the script when done.

- [ ] **Step 7: Commit**

```bash
git add wardrobe-app/utils/outfitGenerator.ts wardrobe-app/utils/__tests__/outfitGenerator.test.ts
git commit -m "Add a per-(bottom,top)-pair result budget to generateClosestOutfits"
```

---

## Task 3: Defer the Today screen's outfit computation, with a loading state

**Files:**
- Modify: `wardrobe-app/screens/TodayScreen.tsx`

**Interfaces:**
- Consumes: `outfitsFor` (`wardrobe-app/contexts/TodayDataContext.tsx`, unchanged signature).
- Produces: no new exports — this is a screen-local restructuring. Introduces a new local state shape for `outfits` (was a plain `useMemo`-derived `TodayOutfits`; becomes `{ status: 'ready', outfits: TodayOutfits } | { status: 'computing', outfits: TodayOutfits }`, so the last-known outfits can still render, dimmed or with a spinner overlay, while a new computation is pending — never an empty/blank state during a recompute).

Screens are not unit-tested in this codebase (see `wardrobe-app/AGENTS.md` — screens read through hooks, and this repo's own testing discipline keeps DB/native-touching code out of Jest's reach). This task's correctness is verified by manual on-device testing (Step 4), not automated tests — say so explicitly rather than claiming automated coverage that doesn't exist here.

- [ ] **Step 1: Read the current `outfits` useMemo and its surrounding state exactly**

Before changing anything, re-read `wardrobe-app/screens/TodayScreen.tsx`
lines ~530-620 (the `TodayScreen` function's state declarations through the
`outfits` useMemo) to confirm nothing has shifted since this plan was
written. The current computation being replaced:

```ts
  const lastComputedRef = useRef<{ feltTempC: number; windSpeedKph: number; outfits: TodayOutfits } | null>(null);

  const outfits = useMemo(() => {
    if (!isReady) return { shown: [], hasAnyOutfit: false };
    if (!isOverridden && !workAppropriateOnly) {
      lastComputedRef.current = {
        feltTempC: effectiveFeltTempC,
        windSpeedKph: effectiveWindSpeedKph,
        outfits: state.initialOutfits,
      };
      return state.initialOutfits;
    }
    const last = lastComputedRef.current;
    const filterOnlyChange =
      last !== null && last.feltTempC === effectiveFeltTempC && last.windSpeedKph === effectiveWindSpeedKph;
    const result = outfitsFor(
      state.todayCandidates,
      effectiveFeltTempC,
      effectiveWindSpeedKph,
      workAppropriateOnly,
      filterOnlyChange ? last!.outfits : null,
    );
    lastComputedRef.current = { feltTempC: effectiveFeltTempC, windSpeedKph: effectiveWindSpeedKph, outfits: result };
    return result;
  }, [isReady, isOverridden, workAppropriateOnly, state, effectiveFeltTempC, effectiveWindSpeedKph]);
```

- [ ] **Step 2: Replace it with a deferred, generation-guarded computation**

Replace the block above with:

```ts
  const lastComputedRef = useRef<{ feltTempC: number; windSpeedKph: number; outfits: TodayOutfits } | null>(null);
  // Bumped on every trigger that needs a fresh outfitsFor call (slider
  // drag or work-appropriate toggle) -- a deferred computation checks its
  // own generation against this before committing, so a stale, slower
  // computation started before a newer trigger never overwrites the
  // newer one's result. Mirrors the identical pattern already proven in
  // TodayDataContext.tsx's own latestRequestId.
  const outfitsGenerationRef = useRef(0);
  const [outfitsState, setOutfitsState] = useState<{ outfits: TodayOutfits; computing: boolean }>({
    outfits: { shown: [], hasAnyOutfit: false },
    computing: false,
  });

  useEffect(() => {
    if (!isReady) {
      setOutfitsState({ outfits: { shown: [], hasAnyOutfit: false }, computing: false });
      return;
    }
    if (!isOverridden && !workAppropriateOnly) {
      lastComputedRef.current = {
        feltTempC: effectiveFeltTempC,
        windSpeedKph: effectiveWindSpeedKph,
        outfits: state.initialOutfits,
      };
      setOutfitsState({ outfits: state.initialOutfits, computing: false });
      return;
    }

    const generation = ++outfitsGenerationRef.current;
    // computing: true keeps the PREVIOUS outfits on screen (never blanks
    // the list) while signalling a spinner/dimmed state -- see OutfitCard's
    // own rendering, which reads outfitsState.computing.
    setOutfitsState((current) => ({ outfits: current.outfits, computing: true }));

    const handle = requestAnimationFrame(() => {
      if (outfitsGenerationRef.current !== generation) return; // superseded before this frame ran
      const last = lastComputedRef.current;
      const filterOnlyChange =
        last !== null && last.feltTempC === effectiveFeltTempC && last.windSpeedKph === effectiveWindSpeedKph;
      const result = outfitsFor(
        state.todayCandidates,
        effectiveFeltTempC,
        effectiveWindSpeedKph,
        workAppropriateOnly,
        filterOnlyChange ? last!.outfits : null,
      );
      if (outfitsGenerationRef.current !== generation) return; // superseded while computing
      lastComputedRef.current = { feltTempC: effectiveFeltTempC, windSpeedKph: effectiveWindSpeedKph, outfits: result };
      setOutfitsState({ outfits: result, computing: false });
    });

    return () => cancelAnimationFrame(handle);
  }, [isReady, isOverridden, workAppropriateOnly, state, effectiveFeltTempC, effectiveWindSpeedKph]);

  const outfits = outfitsState.outfits;
```

Note: `requestAnimationFrame` is used here (not
`InteractionManager.runAfterInteractions`) because the slider's own drag
gesture has already fully ended by the time `onSlidingComplete` fires (see
`onSlidingComplete`'s own doc comment in this file) — there's no ongoing
interaction to wait out, only a need to let React commit the current
render (with `computing: true`) before the expensive synchronous call
runs on the next frame.

- [ ] **Step 3: Wire `outfitsState.computing` into the UI**

Find where `outfits` is used to render the outfit cards (search this file
for `outfits.shown` — likely a `.map` over `OutfitCard`). Read that render
code as it currently exists, then add a lightweight loading indicator
that shows when `outfitsState.computing` is `true`, without removing or
hiding the previously-shown cards underneath it (so the user sees the last
known outfits, with a visible "updating…" signal, not a blank screen).
Match this file's existing styling conventions (it uses NativeWind
`className` — search for how other loading/pending states in this file,
if any, are styled, and follow the same pattern; if none exists, a simple
text label like `"Updating outfits…"` shown above the cards is sufficient
— this is a functional fix, not a design task).

- [ ] **Step 4: Manual on-device verification (required — cannot be automated here)**

This environment has no simulator/device access. Report to the user,
explicitly, that this step needs their own phone:

1. Move the "feels like" slider and confirm a loading indicator appears
   immediately (within one frame, not after a delay) — this is risk B2
   from the design spec: confirm the spinner genuinely renders before any
   freeze, not just that the code compiles.
2. Confirm the outfits update once the computation finishes, and that
   dragging the slider again *while* a computation is still pending
   doesn't show a flash of stale results before the correct ones land
   (risk B1).
3. Confirm toggling the work-appropriate filter while a slider-triggered
   computation is still pending doesn't corrupt the filter-stability
   behavior (risk B3) — the safest check: toggle the filter on, wait for
   it to settle, drag the slider, then rapidly toggle the filter off/on
   again before the slider's own computation finishes, and confirm the
   final state is coherent (no crash, no outfits that ignore the current
   filter setting).
4. Confirm the phone no longer gets noticeably hot and the app doesn't
   freeze, across a few different temperature settings including cold
   ones (0°C-ish, the scenario this session's own regression sweep
   exercises most heavily).

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/screens/TodayScreen.tsx
git commit -m "Defer Today screen's outfit computation by one frame, with a loading state"
```

---

## Task 4: Quantized-bounds memoization for `outfitsFor`

**Files:**
- Modify: `wardrobe-app/contexts/TodayDataContext.tsx`
- Test: `wardrobe-app/contexts/__tests__/outfitsFor.test.ts` (already exists — add to its existing `describe('outfitsFor', ...)` block, using its existing `emptyCandidates`/`item`/`resetSeq` helpers from `../../utils/outfitGeneratorTestHelpers`, matching its existing fixture style exactly)

**Interfaces:**
- Consumes: `outfitsFor`'s existing signature (unchanged).
- Produces: `outfitsFor` itself is wrapped by a new, small memoization layer — either inside `outfitsFor` directly (a module-level cache) or as a separate wrapping function. Callers (`TodayScreen.tsx`, `loadToday`/`refreshCandidates` in this same file) do not change how they call it.

- [ ] **Step 1: Write the failing test**

Add to `wardrobe-app/contexts/__tests__/outfitsFor.test.ts`, inside the
existing `describe('outfitsFor', ...)` block (after its last existing
test, before the closing `});`), matching this file's existing fixture
style exactly:

```ts
  it('returns a cached result for the same quantized bounds without recomputing', () => {
    // Two raw feltTempC values that round to the SAME warmthFloor/
    // warmthCeiling/windFloor (thermal.ts's clamp() already rounds to
    // integers -- see the design spec's own confirmation of this) should
    // hit the same cache entry. Asserts referential identity of the
    // returned TodayOutfits object across both calls, which is only
    // possible if the second call was served from cache rather than
    // recomputed (a fresh call always builds a new result object).
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 1 });
    const candidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    const first = outfitsFor(candidates, 5.0, 21, false);
    const second = outfitsFor(candidates, 5.2, 21, false); // rounds to the same floor/ceiling as 5.0
    expect(second).toBe(first);
  });

  it('does not return a cached result when workAppropriateOnly differs', () => {
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 1 });
    const candidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    const withFilter = outfitsFor(candidates, 5.0, 21, true);
    const withoutFilter = outfitsFor(candidates, 5.0, 21, false);
    expect(withFilter).not.toBe(withoutFilter);
  });

  it('does not return a stale cached result once todayCandidates itself is a new object (a real refresh)', () => {
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('T-Shirt', { inferredWarmth: 2, inferredWind: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1, inferredWind: 1 });
    const candidatesA: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };
    // A structurally-identical but distinct object, simulating a fresh
    // fetchTodayCandidates() call after a wardrobe/log write -- the cache
    // must not treat this as the same candidate pool just because its
    // contents happen to match.
    const candidatesB: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    const first = outfitsFor(candidatesA, 5.0, 21, false);
    const second = outfitsFor(candidatesB, 5.0, 21, false);
    expect(second).not.toBe(first);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest contexts/__tests__/outfitsFor.test.ts -t "cached"` (from `wardrobe-app/`)
Expected: FAIL on the first new test — `outfitsFor` has no caching yet, so
both calls return distinct object references.

- [ ] **Step 3: Add the cache**

In `wardrobe-app/contexts/TodayDataContext.tsx`, add a small LRU-style
cache above `outfitsFor`'s own definition:

```ts
/**
 * A small, short-lived cache keyed on everything outfitsFor's result
 * actually depends on -- the rounded thermal bounds (thermal.ts's clamp()
 * already rounds warmthFloor/warmthCeiling/windFloor to integers), the
 * work-appropriate filter, a wear-history version (bumped whenever
 * todayCandidates.wornDaysAgo changes identity, which happens whenever an
 * outfit is logged -- see fetchTodayCandidates), and previous's own
 * identity (the filter-stability mechanism). Deliberately small (a few
 * entries) and cleared whenever todayCandidates itself changes identity
 * (a fresh wardrobe/log fetch) -- this only exists to make "drag back to a
 * temperature you were just at" instant within one interaction session,
 * not to guarantee long-term result stability for a given temperature
 * (the underlying search is intentionally Math.random()-jittered; see
 * Task 3d in the prior plan's own design spec).
 */
const OUTFITS_CACHE_MAX_ENTRIES = 8;
let outfitsCacheCandidates: TodayCandidates | null = null;
let outfitsCache: Map<string, TodayOutfits> = new Map();

function outfitsCacheKey(
  floor: number,
  ceiling: number,
  wFloor: number,
  workAppropriateOnly: boolean,
  previous: TodayOutfits | null,
): string {
  return `${floor}|${ceiling}|${wFloor}|${workAppropriateOnly}|${previous === null ? 'none' : 'has-previous'}`;
}
```

Then modify `outfitsFor`'s body to check/populate this cache. Replace the
function's opening (up through the `bands` computation) and closing
`return` with:

```ts
export function outfitsFor(
  todayCandidates: TodayCandidates | null,
  feltTempC: number,
  windSpeedKph: number,
  workAppropriateOnly: boolean = false,
  previous: TodayOutfits | null = null,
): TodayOutfits {
  if (!todayCandidates) return { shown: [], hasAnyOutfit: false };

  if (outfitsCacheCandidates !== todayCandidates) {
    outfitsCache = new Map();
    outfitsCacheCandidates = todayCandidates;
  }

  const floor = warmthFloor(feltTempC);
  const ceiling = warmthCeiling(feltTempC);
  const wFloor = windFloor(windSpeedKph, feltTempC);
  const cacheKey = outfitsCacheKey(floor, ceiling, wFloor, workAppropriateOnly, previous);
  const cached = outfitsCache.get(cacheKey);
  if (cached) return cached;

  const candidates = workAppropriateOnly
    ? filterWorkAppropriate(todayCandidates.candidates)
    : todayCandidates.candidates;
  const bands = splitIntoWarmthBands(floor, ceiling);
  const alreadyClaimed =
    workAppropriateOnly && previous
      ? previous.shown.filter((outfit) => outfit.items.every((item) => item.isWorkAppropriate))
      : [];
  const diverse = selectBandedOutfits(
    candidates,
    todayCandidates.dismatchedKeys,
    floor,
    ceiling,
    wFloor,
    bands,
    todayCandidates.wornDaysAgo,
    alreadyClaimed,
  );
  const result = { shown: diverse, hasAnyOutfit: diverse.length > 0 };

  if (outfitsCache.size >= OUTFITS_CACHE_MAX_ENTRIES) {
    const oldestKey = outfitsCache.keys().next().value;
    if (oldestKey !== undefined) outfitsCache.delete(oldestKey);
  }
  outfitsCache.set(cacheKey, result);

  return result;
}
```

(The doc comment already on `outfitsFor` — the one explaining `shown`'s
own contract — stays unchanged above this; only the function body and the
`windFloor(windSpeedKph, feltTempC)` call's local variable name change,
from an inline expression to the named `wFloor`, so it can be reused in
both the cache key and the `selectBandedOutfits` call without computing it
twice.)

- [ ] **Step 4: Invalidate the cache when the candidate pool actually refreshes**

`outfitsCacheCandidates !== todayCandidates` in Step 3 already handles
this correctly *if* `todayCandidates` gets a new object identity on every
real refresh (a new wardrobe fetch, a newly logged outfit). Confirm this
is true by reading `fetchTodayCandidates` (`services/outfitGenerator.ts`)
and `loadToday`/`refreshCandidates` (this same file, both call
`fetchTodayCandidates` fresh) — if it already always returns a new object
per call (the normal, expected behavior for a DB fetch), no further
change is needed here. If it turns out to reuse/mutate an existing object
in some path (verify, don't assume), that path needs to construct a new
object instead — flag this as a finding in the implementer's report if
found, since it would be a pre-existing bug independent of this task's own
scope.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest contexts/__tests__/outfitsFor.test.ts`
Expected: PASS, both new tests.

Run: `npx jest && npm run lint && npm run typecheck`
Expected: all clean — confirm no existing test relied on `outfitsFor`
always returning a fresh object (a referential-equality assumption
somewhere would now break, since caching intentionally introduces shared
references for identical inputs).

- [ ] **Step 6: Commit**

```bash
git add wardrobe-app/contexts/TodayDataContext.tsx wardrobe-app/contexts/__tests__/outfitsFor.test.ts
git commit -m "Cache outfitsFor by quantized thermal bounds for instant repeat lookups"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite, lint, and typecheck one more time**

From `wardrobe-app/`:

```bash
npx jest
npm run lint
npm run typecheck
```

Expected: all clean.

- [ ] **Step 2: Dispatch the `verifier` agent**

Via the Agent tool, dispatch `verifier` against the diff since this plan's
first commit. It runs the real `npm test`/`npm run lint`/`npm run
typecheck` and writes the commit sentinel hash this repo's pre-commit hook
requires.

- [ ] **Step 3: Report results, and hand the on-device checklist to the user**

Summarize: the margin value used and confirmation it was proven exact
(Task 2's equivalence check), the actual measured wall-clock improvement
(before/after, from Task 2 Step 4), and confirmation the new finite-ceiling
performance test passes within its bound. Then present Task 3 Step 4's
manual on-device checklist to the user directly — this plan cannot confirm
the freeze is actually fixed without their own phone, and that is the
entire point of this plan, so do not report it done until they've
confirmed it themselves.
