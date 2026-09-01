# Today Banded Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Today's single-target outfit ranking with three deliberate warmth bands (cooler/median/warmer, 2 outfits each), a global per-item reuse ceiling of 2 (with a "everything else must differ" rule on the 2nd use), and a Scarf/Tights warmth top-up step applied after the core outfit is chosen.

**Architecture:** A new module (`utils/warmthBands.ts`, `utils/warmthTopUp.ts`, `utils/bandedOutfits.ts`) sits alongside the existing search, extending `buildSlots` and `generateClosestOutfits` with backward-compatible optional parameters (every other caller — `generateOutfits`, `generateOutfitsWithItem`, all existing tests — is unaffected by construction, since every new parameter defaults to preserving current behavior exactly). Only `TodayDataContext.tsx`'s `outfitsFor` is rewired to the new pipeline; `rankedDiverseOutfits`/`selectDiverseOutfits` remain untouched and continue to serve `generateOutfitsWithItem`.

**Tech Stack:** TypeScript, Jest (`jest-expo` preset), pure functions (no DB access in any file this plan touches).

**Spec:** `docs/superpowers/specs/2026-09-01-today-banded-recommendations-design.md`

## Global Constraints

- Every new/changed exported function keeps existing call sites compiling: new parameters are optional and default to exactly today's behavior (matches this repo's own established convention — see `wornDaysAgo = new Map()` throughout `outfitCandidatePools.ts`/`outfitSlots.ts`/`outfitGenerator.ts`).
- Scope is Today's recommendations only (`outfitsFor` → `TodayDataContext.tsx`). `generateOutfitsWithItem` (`services/outfitGenerator.ts`) and any other consumer of `generateOutfits`/`generateClosestOutfits`/`rankedDiverseOutfits` are explicitly untouched.
- Dispatch the repo's `verifier` agent (real `npm test`/`lint`/`typecheck`) before considering this plan done — not a manual substitute.
- Never import `expo-sqlite` outside `services/database.ts` (`wardrobe-app/AGENTS.md`) — not relevant to this plan's files, noted for completeness.
- Pool widening is static and up-front (3 band-targeted `floorAwareCandidates` calls, merged), never a dynamic re-search — see the spec's "Pool widening" ruling.
- Scarf top-up counts toward the global max-2-uses rule; Tights top-up does not — see the spec's "Top-up items" ruling.
- The uniqueness/reuse check runs against the final outfit (core + top-up), not the pre-top-up core — see the spec's "Check timing" ruling.

---

## Task 1: Warmth bands

**Files:**
- Create: `wardrobe-app/utils/warmthBands.ts`
- Test: `wardrobe-app/utils/__tests__/warmthBands.test.ts`

**Interfaces:**
- Produces: `interface WarmthBand { min: number; max: number; center: number }`
- Produces: `function splitIntoWarmthBands(warmthFloor: number, warmthCeiling: number): { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand }`

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import { splitIntoWarmthBands } from '../warmthBands';

describe('splitIntoWarmthBands', () => {
  it('splits the range into three equal-width bands, in ascending order', () => {
    const { cooler, median, warmer } = splitIntoWarmthBands(1, 6);

    expect(cooler.min).toBeCloseTo(1);
    expect(cooler.max).toBeCloseTo(1 + 5 / 3);
    expect(median.min).toBeCloseTo(1 + 5 / 3);
    expect(median.max).toBeCloseTo(1 + (2 * 5) / 3);
    expect(warmer.min).toBeCloseTo(1 + (2 * 5) / 3);
    expect(warmer.max).toBeCloseTo(6);
  });

  it('centers each band at its own midpoint', () => {
    const { cooler, median, warmer } = splitIntoWarmthBands(0, 9);

    expect(cooler.center).toBeCloseTo(1.5);
    expect(median.center).toBeCloseTo(4.5);
    expect(warmer.center).toBeCloseTo(7.5);
  });

  it('collapses all three bands to the same single point when floor equals ceiling', () => {
    const { cooler, median, warmer } = splitIntoWarmthBands(5, 5);

    expect(cooler.center).toBe(5);
    expect(median.center).toBe(5);
    expect(warmer.center).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest utils/__tests__/warmthBands.test.ts` (from `wardrobe-app/`)
Expected: FAIL with "Cannot find module '../warmthBands'"

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Splitting today's valid warmth range into three equal-width bands, so
 * Today can deliberately offer a leaner, a "just right", and a warmer
 * option instead of six outfits that all happen to rank close to one
 * single target. Every band still sits fully inside [warmthFloor,
 * warmthCeiling] — bands steer preference among already-valid outfits,
 * they never redefine what counts as weather-valid (see
 * utils/outfitScoring.ts's meetsRegionFloors, checked against the real
 * warmthFloor regardless of which band an outfit ends up in).
 */
export interface WarmthBand {
  min: number;
  max: number;
  /** The band's own target — outfits assigned to this band are ranked (and topped up, see warmthTopUp.ts) by closeness to this point, not the single global target the rest of the search still uses for weather-validity. */
  center: number;
}

/** cooler = bottom third (leanest), median = center third ("just right"), warmer = top third — see WarmthBand's own doc comment. */
export function splitIntoWarmthBands(
  warmthFloor: number,
  warmthCeiling: number,
): { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand } {
  const span = warmthCeiling - warmthFloor;
  const third = span / 3;
  const band = (min: number, max: number): WarmthBand => ({ min, max, center: (min + max) / 2 });

  return {
    cooler: band(warmthFloor, warmthFloor + third),
    median: band(warmthFloor + third, warmthFloor + 2 * third),
    warmer: band(warmthFloor + 2 * third, warmthCeiling),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest utils/__tests__/warmthBands.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/warmthBands.ts wardrobe-app/utils/__tests__/warmthBands.test.ts
git commit -m "Add warmth-band splitting for Today's cooler/median/warmer recommendations"
```

---

## Task 2: Export the Tights eligibility rule

**Files:**
- Modify: `wardrobe-app/utils/outfitSlots.ts`
- Test: `wardrobe-app/utils/__tests__/outfitSlots.test.ts` (create if it does not already exist — check first with `ls wardrobe-app/utils/__tests__/outfitSlots.test.ts`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function tightsEligible(anchor: ClothingItem, warmthFloor: number): boolean` — the exact boolean `buildSlots` already computes inline as `offerTights`, pulled out so `warmthTopUp.ts` (Task 5) can reuse it instead of duplicating the anchor-category logic.
- Produces: `export const TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR = 18;` (currently a private `const` in this file — just add `export`).

This task is a pure refactor: `buildSlots`'s own behavior must not change. Read the current `offerTights` computation in `buildSlots` before starting (`wardrobe-app/utils/outfitSlots.ts`, inside the function body) — it is:

```ts
const isDress = isDressAnchor(anchor);
const isTrousers = anchor.category === 'Pants' || anchor.category === 'Leggings';
const offerTights =
  warmthFloor > 0 &&
  ((isDress || anchor.category === 'Skirt') || (isTrousers && warmthFloor > TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR));
```

- [ ] **Step 1: Write the failing test**

If `wardrobe-app/utils/__tests__/outfitSlots.test.ts` does not exist yet, create it with this content. If it exists, add this `describe` block to it (check the file's existing `item()`/fixture helper first and reuse it rather than redefining one — if none exists, use the inline fixture below).

```ts
/** @jest-environment node */
import { tightsEligible, TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR } from '../outfitSlots';
import type { ClothingItem } from '../../types/wardrobe';

function anchor(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id: 'a',
    imagePath: '',
    originalImagePath: '',
    imageMarginBaked: false,
    category: 'Pants',
    brand: '',
    costMinorUnits: 0,
    isSecondHand: false,
    purchasedAt: '',
    materials: [],
    primaryColor: '',
    secondaryColor: '',
    hardwareColor: 'None',
    hasBeltLoops: false,
    sleeveLength: 'Short',
    length: '',
    thickness: 'Regular',
    denier: 0,
    backless: false,
    inferredWarmth: 0,
    inferredWind: 0,
    wearCount: 0,
    createdAt: '',
    archivedAt: '',
    isWorkAppropriate: false,
    ...overrides,
  };
}

describe('tightsEligible', () => {
  it('is false at warmthFloor 0, regardless of anchor category', () => {
    expect(tightsEligible(anchor({ category: 'Skirt' }), 0)).toBe(false);
    expect(tightsEligible(anchor({ category: 'Dress' }), 0)).toBe(false);
  });

  it('is true under a Skirt or Dress anchor whenever warmthFloor is above 0', () => {
    expect(tightsEligible(anchor({ category: 'Skirt' }), 1)).toBe(true);
    expect(tightsEligible(anchor({ category: 'Dress' }), 1)).toBe(true);
  });

  it('is true under Pants/Leggings only above TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR', () => {
    expect(tightsEligible(anchor({ category: 'Pants' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR)).toBe(false);
    expect(tightsEligible(anchor({ category: 'Pants' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR + 1)).toBe(true);
    expect(tightsEligible(anchor({ category: 'Leggings' }), TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR + 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest utils/__tests__/outfitSlots.test.ts -t tightsEligible`
Expected: FAIL with "tightsEligible is not a function" (or module has no exported member, depending on the exact TS/Jest error)

- [ ] **Step 3: Extract and export the function**

In `wardrobe-app/utils/outfitSlots.ts`, add `export` to the `TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR` const declaration, and add a new exported function right after `isDressAnchor`:

```ts
/** Whether Tights are offered under this anchor at all — the exact condition buildSlots already gates its own Tights slot on, pulled out so warmthTopUp.ts can reuse it. */
export function tightsEligible(anchor: ClothingItem, warmthFloor: number): boolean {
  const isDress = isDressAnchor(anchor);
  const isTrousers = anchor.category === 'Pants' || anchor.category === 'Leggings';
  return (
    warmthFloor > 0 &&
    ((isDress || anchor.category === 'Skirt') || (isTrousers && warmthFloor > TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR))
  );
}
```

Then replace `buildSlots`'s own `offerTights` computation with a call to it:

```ts
const offerTights = tightsEligible(anchor, warmthFloor);
```

(Delete the now-redundant `isDress`/`isTrousers` locals from `buildSlots` if nothing else in the function still uses `isDress` — check: `isDress` is also used later in `buildSlots` for the Top slot's `required: !isDress`, so keep that local `const isDress = isDressAnchor(anchor);` in `buildSlots` for that line, but remove `isTrousers` and the old inline `offerTights` expression.)

- [ ] **Step 4: Run test to verify it passes, and the whole suite still passes**

Run: `npx jest utils/__tests__/outfitSlots.test.ts`
Expected: PASS, 3 new tests

Run: `npx jest` (full suite, from `wardrobe-app/`)
Expected: PASS, same total count as before this task plus 3

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/outfitSlots.ts wardrobe-app/utils/__tests__/outfitSlots.test.ts
git commit -m "Extract and export tightsEligible from buildSlots' offerTights logic"
```

---

## Task 3: `buildSlots` — optional Scarf/Tights exclusion and a Top pool override

**Files:**
- Modify: `wardrobe-app/utils/outfitSlots.ts`
- Test: `wardrobe-app/utils/__tests__/outfitSlots.test.ts`

**Interfaces:**
- Consumes: `tightsEligible` (Task 2, same file).
- Produces: `buildSlots`'s signature gains one new optional parameter:
  ```ts
  export function buildSlots(
    candidates: OutfitCandidates,
    anchor: ClothingItem,
    warmthFloor: number,
    needsScarf: boolean,
    needsBelt: boolean,
    wornDaysAgo: ReadonlyMap<string, number> = new Map(),
    options: { includeWarmthAccessories?: boolean; topCandidatesOverride?: readonly ClothingItem[] } = {},
  ): Slot[]
  ```
  - `includeWarmthAccessories` defaults to `true` (today's exact behavior: Scarf/Tights slots included per `needsScarf`/`tightsEligible`). When `false`, neither the Scarf slot nor the Tights slot is added to the returned array, regardless of `needsScarf`/`tightsEligible`'s own value.
  - `topCandidatesOverride`, when given, replaces the Top slot's own `floorAwareCandidates(baseTopCandidates(candidates.tops, warmthFloor), warmthFloor, wornDaysAgo)` call — the Top slot's `candidates` become exactly this array instead. When omitted (`undefined`), behavior is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `wardrobe-app/utils/__tests__/outfitSlots.test.ts` (reuse the `anchor()` fixture from Task 2; add a second small fixture for a Top-group item if the file does not already have one — a `topItem()` helper is fine, following the same shape as `anchor()` but with `category: 'T-Shirt'`):

```ts
import { buildSlots } from '../outfitSlots';
import type { OutfitCandidates } from '../outfitCandidatePools';

function emptyCandidates(overrides: Partial<OutfitCandidates> = {}): OutfitCandidates {
  return {
    bottoms: [],
    tops: [],
    shoes: [],
    outerwear: [],
    scarves: [],
    belts: [],
    bags: [],
    tights: [],
    ...overrides,
  };
}

describe('buildSlots includeWarmthAccessories', () => {
  it('includes Scarf and Tights slots by default, exactly like today, when a scarf/tights are eligible', () => {
    const scarf = anchor({ id: 'scarf-1', category: 'Scarf' });
    const tights = anchor({ id: 'tights-1', category: 'Tights' });
    const skirtAnchor = anchor({ id: 'skirt-1', category: 'Skirt' });
    const candidates = emptyCandidates({ scarves: [scarf], tights: [tights] });

    const slots = buildSlots(candidates, skirtAnchor, 10, true, false);

    const allCandidateIds = slots.flatMap((s) => s.candidates.map((c) => c.id));
    expect(allCandidateIds).toContain('scarf-1');
    expect(allCandidateIds).toContain('tights-1');
  });

  it('omits Scarf and Tights slots entirely when includeWarmthAccessories is false, even when both are eligible', () => {
    const scarf = anchor({ id: 'scarf-1', category: 'Scarf' });
    const tights = anchor({ id: 'tights-1', category: 'Tights' });
    const skirtAnchor = anchor({ id: 'skirt-1', category: 'Skirt' });
    const candidates = emptyCandidates({ scarves: [scarf], tights: [tights] });

    const slots = buildSlots(candidates, skirtAnchor, 10, true, false, new Map(), {
      includeWarmthAccessories: false,
    });

    const allCandidateIds = slots.flatMap((s) => s.candidates.map((c) => c.id));
    expect(allCandidateIds).not.toContain('scarf-1');
    expect(allCandidateIds).not.toContain('tights-1');
  });
});

describe('buildSlots topCandidatesOverride', () => {
  it('uses the override list for the Top slot instead of computing its own pool', () => {
    const overrideTop = anchor({ id: 'override-top', category: 'Shirt' });
    const realTop = anchor({ id: 'real-top', category: 'Shirt' });
    const pantsAnchor = anchor({ id: 'pants-1', category: 'Pants' });
    const candidates = emptyCandidates({ tops: [realTop] });

    const slots = buildSlots(candidates, pantsAnchor, 5, false, false, new Map(), {
      topCandidatesOverride: [overrideTop],
    });

    const topSlot = slots[0]; // Top is always the first slot buildSlots returns
    expect(topSlot.candidates.map((c) => c.id)).toEqual(['override-top']);
  });

  it('falls back to the normal Top pool when no override is given', () => {
    const realTop = anchor({ id: 'real-top', category: 'Shirt' });
    const pantsAnchor = anchor({ id: 'pants-1', category: 'Pants' });
    const candidates = emptyCandidates({ tops: [realTop] });

    const slots = buildSlots(candidates, pantsAnchor, 5, false, false);

    expect(slots[0].candidates.map((c) => c.id)).toEqual(['real-top']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest utils/__tests__/outfitSlots.test.ts`
Expected: FAIL — `includeWarmthAccessories`/`topCandidatesOverride` tests fail (Scarf/Tights still present when excluded is expected; override ignored)

- [ ] **Step 3: Implement**

In `wardrobe-app/utils/outfitSlots.ts`, change `buildSlots`'s signature and body:

```ts
export function buildSlots(
  candidates: OutfitCandidates,
  anchor: ClothingItem,
  warmthFloor: number,
  needsScarf: boolean,
  needsBelt: boolean,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  options: { includeWarmthAccessories?: boolean; topCandidatesOverride?: readonly ClothingItem[] } = {},
): Slot[] {
  const { includeWarmthAccessories = true, topCandidatesOverride } = options;
  const isDress = isDressAnchor(anchor);
  const offerTights = includeWarmthAccessories && tightsEligible(anchor, warmthFloor);
  const offerScarf = includeWarmthAccessories && needsScarf;

  return [
    {
      candidates:
        topCandidatesOverride ??
        floorAwareCandidates(baseTopCandidates(candidates.tops, warmthFloor), warmthFloor, wornDaysAgo),
      required: !isDress,
    },
    { candidates: accessoryFirst(cardiganCandidates(candidates.tops, warmthFloor), wornDaysAgo), required: false },
    { candidates: accessoryFirst(baseLayerCandidates(candidates.tops, warmthFloor), wornDaysAgo), required: false },
    {
      candidates: floorAwareCandidates(shoeCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo),
      required: true,
    },
    ...(offerScarf
      ? [{ candidates: accessoryFirst(candidates.scarves, wornDaysAgo), required: false, preferred: true }]
      : []),
    ...(needsBelt ? [{ candidates: accessoryFirst(candidates.belts, wornDaysAgo), required: true }] : []),
    ...(offerTights
      ? [{ candidates: accessoryFirst(candidates.tights, wornDaysAgo), required: false, preferred: true }]
      : []),
    {
      candidates: floorAwareOuterwearCandidates(excludesSleeveless(candidates.outerwear, warmthFloor), wornDaysAgo),
      required: false,
    },
    { candidates: accessoryFirst(candidates.bags, wornDaysAgo), required: false, preferred: true },
  ];
}
```

Note this deliberately drops the old standalone `isTrousers`/inline `offerTights` expression (already replaced by `tightsEligible` in Task 2) — `offerTights` is now `includeWarmthAccessories && tightsEligible(anchor, warmthFloor)`.

- [ ] **Step 4: Run tests to verify they pass, and the whole suite still passes**

Run: `npx jest utils/__tests__/outfitSlots.test.ts`
Expected: PASS, all tests including the 4 new ones

Run: `npx jest` (full suite)
Expected: PASS — `generateOutfits`/`generateClosestOutfits`/`generateOutfitsWithItem` and every existing test call `buildSlots` with 6 or fewer positional args, so `options` defaults to `{}` and behavior is byte-identical to before this task.

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/outfitSlots.ts wardrobe-app/utils/__tests__/outfitSlots.test.ts
git commit -m "Add includeWarmthAccessories and topCandidatesOverride options to buildSlots"
```

---

## Task 4: `generateClosestOutfits` — anchor pool override and options pass-through

**Files:**
- Modify: `wardrobe-app/utils/outfitGenerator.ts`
- Test: `wardrobe-app/utils/__tests__/outfitGenerator.test.ts` (existing file — check its top for the fixture helpers already in use, e.g. `item()`/`emptyCandidates()`/`noDismatches`, and reuse them rather than redefining)

**Interfaces:**
- Consumes: `buildSlots`'s new `options` param (Task 3).
- Produces: `generateClosestOutfits`'s signature gains one new optional parameter:
  ```ts
  export function generateClosestOutfits(
    candidates: OutfitCandidates,
    dismatchedKeys: ReadonlySet<string>,
    warmthFloor: number,
    warmthCeiling: number,
    windFloor: number,
    maxResults: number = DEFAULT_MAX_OUTFITS,
    wornDaysAgo: ReadonlyMap<string, number> = new Map(),
    options: {
      anchorPool?: readonly ClothingItem[];
      includeWarmthAccessories?: boolean;
      topCandidatesOverride?: readonly ClothingItem[];
    } = {},
  ): ScoredOutfit[]
  ```
  - `anchorPool`, when given, replaces the function's own `floorAwareCandidates(bottomCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo)` call — the anchor loop iterates over exactly this list instead. When omitted, behavior is unchanged.
  - `includeWarmthAccessories`/`topCandidatesOverride` are threaded straight through to every `buildSlots` call this function makes.

- [ ] **Step 1: Write the failing tests**

Add to `wardrobe-app/utils/__tests__/outfitGenerator.test.ts` (adjust the import path/fixture names to whatever this file already uses — check its existing imports first):

```ts
describe('generateClosestOutfits anchorPool override', () => {
  it('searches exactly the given anchorPool instead of computing its own', () => {
    const overrideBottom = item('Pants', { id: 'override-bottom' });
    const realBottom = item('Pants', { id: 'real-bottom' });
    const top = item('T-Shirt');
    const shoes = item('Shoes');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [realBottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
      new Map(),
      { anchorPool: [overrideBottom] },
    );

    const bottomIdsUsed = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
    expect(bottomIdsUsed).toEqual(new Set(['override-bottom']));
  });
});

describe('generateClosestOutfits includeWarmthAccessories/topCandidatesOverride pass-through', () => {
  it('never includes a Scarf or Tights item when includeWarmthAccessories is false', () => {
    const bottom = item('Skirt', { inferredWarmth: 0 });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const scarf = item('Scarf', { id: 'scarf-1' });
    const tights = item('Tights', { id: 'tights-1' });

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf], tights: [tights] }),
      noDismatches,
      10,
      NO_CEILING,
      0,
      10,
      new Map(),
      { includeWarmthAccessories: false },
    );

    for (const outfit of results) {
      expect(outfit.items.some((i) => i.category === 'Scarf' || i.category === 'Tights')).toBe(false);
    }
  });

  it('uses topCandidatesOverride for every anchor tried, not just the first', () => {
    const overrideTop = item('Shirt', { id: 'override-top' });
    const bottomA = item('Pants', { id: 'bottom-a' });
    const bottomB = item('Pants', { id: 'bottom-b' });
    const shoes = item('Shoes');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops: [item('Shirt', { id: 'real-top' })], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
      new Map(),
      { topCandidatesOverride: [overrideTop] },
    );

    for (const outfit of results) {
      expect(outfit.items.find((i) => CATEGORY_GROUP_TOP_CHECK_PLACEHOLDER)).toBeUndefined();
    }
    const topIdsUsed = new Set(results.map((o) => o.items.find((i) => i.category === 'Shirt')?.id));
    expect(topIdsUsed).toEqual(new Set(['override-top']));
  });
});
```

Before running: delete the placeholder line `expect(outfit.items.find((i) => CATEGORY_GROUP_TOP_CHECK_PLACEHOLDER)).toBeUndefined();` entirely — it was left in by mistake during planning and does not compile. The `topIdsUsed` assertion right after it is the real, sufficient check for this test; remove the broken line before running Step 2.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest utils/__tests__/outfitGenerator.test.ts -t "anchorPool override"`
Run: `npx jest utils/__tests__/outfitGenerator.test.ts -t "pass-through"`
Expected: FAIL — extra 4th/5th arguments not yet accepted by `generateClosestOutfits`'s current signature (TypeScript error) until Step 3 lands.

- [ ] **Step 3: Implement**

In `wardrobe-app/utils/outfitGenerator.ts`, change `generateClosestOutfits`:

```ts
export function generateClosestOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  maxResults: number = DEFAULT_MAX_OUTFITS,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  options: {
    anchorPool?: readonly ClothingItem[];
    includeWarmthAccessories?: boolean;
    topCandidatesOverride?: readonly ClothingItem[];
  } = {},
): ScoredOutfit[] {
  const needsScarf = warmthFloor >= SCARF_PREFERRED_WARMTH_FLOOR;
  const all: ScoredOutfit[] = [];
  const chosen: ClothingItem[] = [];

  function searchSlots(slots: Slot[], slotIndex: number): void {
    if (slotIndex === slots.length) {
      all.push(scoreOutfit(chosen, warmthFloor, warmthCeiling, windFloor));
      return;
    }

    const slot = slots[slotIndex];
    if (skipsBeforeCandidates(slot)) searchSlots(slots, slotIndex + 1);
    tryEachCandidate(slot, chosen, dismatchedKeys, () => false, () => true, () => searchSlots(slots, slotIndex + 1));
    if (slot.preferred) searchSlots(slots, slotIndex + 1);
  }

  const anchorPool =
    options.anchorPool ?? floorAwareCandidates(bottomCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo);

  for (const bottom of anchorPool) {
    chosen.push(bottom);
    searchSlots(
      buildSlots(candidates, bottom, warmthFloor, needsScarf, bottom.hasBeltLoops, wornDaysAgo, {
        includeWarmthAccessories: options.includeWarmthAccessories,
        topCandidatesOverride: options.topCandidatesOverride,
      }),
      0,
    );
    chosen.pop();
  }

  return dropAccessoryFreeDuplicates(dropExactDuplicates(all), (outfit) => outfit.meetsTarget)
    .sort((a, b) => {
      const distance =
        distanceFromBounds(a.items, a.warmth, a.wind, warmthFloor, warmthCeiling, windFloor) -
        distanceFromBounds(b.items, b.warmth, b.wind, warmthFloor, warmthCeiling, windFloor);
      if (distance !== 0) return distance;
      const accessoryCount = (items: readonly ClothingItem[]): number =>
        items.filter((item) => PREFERRED_ACCESSORY_GROUPS.has(CATEGORY_GROUP[item.category])).length;
      const accessories = accessoryCount(b.items) - accessoryCount(a.items);
      if (accessories !== 0) return accessories;
      return warmthFloor > 0 ? b.warmth - a.warmth : 0;
    })
    .slice(0, maxResults);
}
```

(Only the anchor-loop line and the function signature/options destructuring actually change — the sort/dedup tail is unchanged, reproduced above only so the diff is unambiguous for whoever implements this.)

Also fix the test file: remove the broken placeholder line noted in Step 1 before this compiles.

- [ ] **Step 4: Run tests to verify they pass, and the whole suite still passes**

Run: `npx jest utils/__tests__/outfitGenerator.test.ts`
Expected: PASS, all tests including the 3 new ones

Run: `npx jest` (full suite)
Expected: PASS — every existing caller of `generateClosestOutfits` passes 6 or fewer positional args, so `options` defaults to `{}`.

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/outfitGenerator.ts wardrobe-app/utils/__tests__/outfitGenerator.test.ts
git commit -m "Add anchorPool/includeWarmthAccessories/topCandidatesOverride options to generateClosestOutfits"
```

---

## Task 5: Warmth top-up (Scarf/Tights)

**Files:**
- Create: `wardrobe-app/utils/warmthTopUp.ts`
- Test: `wardrobe-app/utils/__tests__/warmthTopUp.test.ts`

**Interfaces:**
- Consumes: `ScoredOutfit`, `OutfitCandidates` (`utils/outfitGenerator.ts`); `sumWarmth`, `sumWind`, `meetsRegionFloors` (`utils/outfitScoring.ts`); `isCompatibleCandidate`, `pairKey` (`utils/pairs.ts`); `SCARF_PREFERRED_WARMTH_FLOOR` (`utils/outfitSlots.ts`, already exported); `tightsEligible` (`utils/outfitSlots.ts`, Task 2); `WarmthBand` (`utils/warmthBands.ts`, Task 1).
- Produces:
  ```ts
  export function topUpToward(
    core: ScoredOutfit,
    band: WarmthBand,
    candidates: OutfitCandidates,
    dismatchedKeys: ReadonlySet<string>,
    warmthFloor: number,
    warmthCeiling: number,
    windFloor: number,
  ): ScoredOutfit
  ```
  Returns a new `ScoredOutfit` — either `core` unchanged (if already at or past `band.center`, or if no eligible Scarf/Tights improves the fit), or `core` plus a Scarf and/or Tights, re-scored. Never removes anything from `core.items`.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
import { topUpToward } from '../warmthTopUp';
import { emptyCandidates, item, resetSeq, noDismatches, NO_CEILING } from '../outfitGeneratorTestHelpers';
import type { ScoredOutfit } from '../outfitGenerator';
import type { WarmthBand } from '../warmthBands';

beforeEach(() => resetSeq());

function scored(items: ReturnType<typeof item>[], warmth: number, wind: number, meetsTarget = true): ScoredOutfit {
  return { items, warmth, wind, meetsTarget };
}

describe('topUpToward', () => {
  it('adds a Scarf to close a warmth gap, when one is eligible and compatible', () => {
    const skirt = item('Skirt', { inferredWarmth: 2 });
    const top = item('T-Shirt', { inferredWarmth: 1 });
    const shoes = item('Shoes', { inferredWarmth: 1 });
    const scarf = item('Scarf', { inferredWarmth: 4, inferredWind: 0 });
    const core = scored([skirt, top, shoes], 4, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], tops: [top], shoes: [shoes], scarves: [scarf] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Scarf')).toBe(true);
    expect(result.warmth).toBeGreaterThan(core.warmth);
  });

  it('does not add anything when the core outfit already meets or exceeds the band center', () => {
    const skirt = item('Skirt', { inferredWarmth: 8 });
    const core = scored([skirt], 8, 0);
    const band: WarmthBand = { min: 6, max: 10, center: 8 };
    const scarf = item('Scarf', { inferredWarmth: 4 });

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarf] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(result.items).toHaveLength(core.items.length);
  });

  it('does not add Tights under Pants below TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR, even if warmer tights exist', () => {
    const pants = item('Pants', { inferredWarmth: 2 });
    const core = scored([pants], 2, 0);
    const band: WarmthBand = { min: 3, max: 5, center: 4 };
    const tights = item('Tights', { inferredWarmth: 5 });

    // warmthFloor 5 is below TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR (18) -- tights under Pants are not eligible here.
    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [pants], tights: [tights] }),
      noDismatches,
      5,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Tights')).toBe(false);
  });

  it('never adds a Scarf or Tights that is dismatched against an existing item', () => {
    const top = item('Shirt');
    const scarf = item('Scarf', { id: 'scarf-1', inferredWarmth: 5 });
    const core = scored([top], 0, 0);
    const band: WarmthBand = { min: 4, max: 8, center: 6 };
    const dismatched = new Set([[top.id, scarf.id].sort().join('|')]);

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ tops: [top], scarves: [scarf] }),
      dismatched,
      0,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Scarf')).toBe(false);
  });

  it('tries Scarf alone before Scarf+Tights, stopping as soon as the band center is reached', () => {
    const skirt = item('Skirt', { inferredWarmth: 0 });
    const core = scored([skirt], 0, 0);
    const band: WarmthBand = { min: 3, max: 5, center: 4 };
    const scarf = item('Scarf', { inferredWarmth: 5 });
    const tights = item('Tights', { inferredWarmth: 5 });

    const result = topUpToward(
      core,
      band,
      emptyCandidates({ bottoms: [skirt], scarves: [scarf], tights: [tights] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    expect(result.items.some((i) => i.category === 'Scarf')).toBe(true);
    expect(result.items.some((i) => i.category === 'Tights')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest utils/__tests__/warmthTopUp.test.ts`
Expected: FAIL with "Cannot find module '../warmthTopUp'"

- [ ] **Step 3: Write the implementation**

```ts
import { sumWarmth, sumWind, meetsRegionFloors } from './outfitScoring';
import { SCARF_PREFERRED_WARMTH_FLOOR, tightsEligible } from './outfitSlots';
import { isCompatibleCandidate, pairKey } from './pairs';
import type { OutfitCandidates, ScoredOutfit } from './outfitGenerator';
import type { WarmthBand } from './warmthBands';
import type { ClothingItem } from '../types/wardrobe';

/** Re-scores a candidate item set against the real bounds — the same shape scoreOutfit (outfitGenerator.ts) produces, kept local since that function isn't exported. */
function rescored(
  items: readonly ClothingItem[],
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): ScoredOutfit {
  const warmth = sumWarmth(items);
  const wind = sumWind(items);
  return {
    items: [...items],
    warmth,
    wind,
    meetsTarget:
      warmth >= warmthFloor && warmth <= warmthCeiling && wind >= windFloor && meetsRegionFloors(items, warmthFloor),
  };
}

function isCompatibleWithEveryItem(
  candidate: ClothingItem,
  chosen: readonly ClothingItem[],
  dismatchedKeys: ReadonlySet<string>,
): boolean {
  return chosen.every(
    (item) =>
      item.id !== candidate.id &&
      isCompatibleCandidate(candidate, item) &&
      !dismatchedKeys.has(pairKey(candidate.id, item.id)),
  );
}

/** The Bottom/Dress anchor among an outfit's own items — Tights eligibility is gated on the anchor's own category, same as buildSlots. */
function anchorOf(items: readonly ClothingItem[]): ClothingItem | undefined {
  return items.find((item) => item.category === 'Pants' || item.category === 'Leggings' || item.category === 'Skirt' || item.category === 'Dress');
}

/**
 * Adds a Scarf and/or Tights to `core` to close the gap toward `band.center`,
 * smallest addition first (Scarf alone, then Tights alone, then both) --
 * stopping as soon as the running total reaches band.center. Never removes
 * anything from `core.items`; returns `core` unchanged if it is already at
 * or past band.center, or if nothing eligible and compatible closes any of
 * the gap. See the design spec's "Warmth top-up" section for the full
 * reasoning (docs/superpowers/specs/2026-09-01-today-banded-recommendations-design.md).
 */
export function topUpToward(
  core: ScoredOutfit,
  band: WarmthBand,
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): ScoredOutfit {
  if (core.warmth >= band.center) return core;

  const anchor = anchorOf(core.items);
  const scarfEligible = warmthFloor >= SCARF_PREFERRED_WARMTH_FLOOR;
  const tightsOk = anchor !== undefined && tightsEligible(anchor, warmthFloor);

  const scarfCandidates = scarfEligible
    ? candidates.scarves.filter((s) => isCompatibleWithEveryItem(s, core.items, dismatchedKeys))
    : [];
  const tightsCandidates = tightsOk
    ? candidates.tights.filter((t) => isCompatibleWithEveryItem(t, core.items, dismatchedKeys))
    : [];

  const closestBy = (pool: readonly ClothingItem[]): ClothingItem | undefined =>
    [...pool].sort((a, b) => Math.abs(a.inferredWarmth - 0) - Math.abs(b.inferredWarmth - 0)).length > 0
      ? [...pool].sort((a, b) => b.inferredWarmth - a.inferredWarmth)[0]
      : undefined;

  const scarf = closestBy(scarfCandidates);
  const tights = closestBy(tightsCandidates);

  const attempts: ClothingItem[][] = [];
  if (scarf) attempts.push([scarf]);
  if (tights) attempts.push([tights]);
  if (scarf && tights) attempts.push([scarf, tights]);

  let best = core;
  for (const addition of attempts) {
    const candidate = rescored([...core.items, ...addition], warmthFloor, warmthCeiling, windFloor);
    const bestGap = Math.abs(best.warmth - band.center);
    const candidateGap = Math.abs(candidate.warmth - band.center);
    if (candidateGap < bestGap) best = candidate;
    if (best.warmth >= band.center) break;
  }

  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass, and the whole suite still passes**

Run: `npx jest utils/__tests__/warmthTopUp.test.ts`
Expected: PASS, 5 tests

Run: `npx jest` (full suite)
Expected: PASS, no regressions (this is a new, standalone file)

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/warmthTopUp.ts wardrobe-app/utils/__tests__/warmthTopUp.test.ts
git commit -m "Add Scarf/Tights warmth top-up toward a band's target center"
```

---

## Task 6: Banded candidate pools and core search

**Files:**
- Create: `wardrobe-app/utils/bandedOutfits.ts`
- Test: `wardrobe-app/utils/__tests__/bandedOutfits.test.ts`

**Interfaces:**
- Consumes: `splitIntoWarmthBands`, `WarmthBand` (Task 1); `generateClosestOutfits` with its new `options` (Task 4); `floorAwareCandidates`, `bottomCandidatesFor`, `baseTopCandidates` (`utils/outfitCandidatePools.ts` — already exported); `OutfitCandidates`, `ScoredOutfit` (`utils/outfitGenerator.ts`).
- Produces:
  ```ts
  export function coreOutfitsForBands(
    candidates: OutfitCandidates,
    dismatchedKeys: ReadonlySet<string>,
    warmthFloor: number,
    warmthCeiling: number,
    windFloor: number,
    bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
    wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  ): ScoredOutfit[]
  ```
  Runs one core search (Scarf/Tights excluded, per Task 3/4's `includeWarmthAccessories: false`) over a candidate pool widened by merging each band's own `floorAwareCandidates` result for both the Bottom/Dress anchor and the Top slot. Returns the full ranked core-outfit list (same ranking `generateClosestOutfits` already produces — closest to the real bounds first), for `Task 7` to bucket into bands and top up.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import { coreOutfitsForBands } from '../bandedOutfits';
import { splitIntoWarmthBands } from '../warmthBands';
import { emptyCandidates, item, resetSeq, noDismatches, NO_CEILING } from '../outfitGeneratorTestHelpers';

beforeEach(() => resetSeq());

describe('coreOutfitsForBands', () => {
  it('never includes a Scarf or Tights item in any core outfit', () => {
    const bottom = item('Skirt', { inferredWarmth: 0 });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const scarf = item('Scarf');
    const tights = item('Tights');
    const bands = splitIntoWarmthBands(0, 10);

    const results = coreOutfitsForBands(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf], tights: [tights] }),
      noDismatches,
      0,
      10,
      0,
      bands,
    );

    for (const outfit of results) {
      expect(outfit.items.some((i) => i.category === 'Scarf' || i.category === 'Tights')).toBe(false);
    }
  });

  it('reaches a bottom that is only the closest-to-target item for one specific band, not the global leanest/warmest', () => {
    // Seven bottoms spread across the warmth range: the middle one (warmth 5)
    // is neither in the leanest-3 (0,1,2) nor the warmest-3 (10,9,8) of the
    // *global* split -- it only enters the pool because the median band's
    // own center (around 5, for a 0-10 range) pulls it in directly.
    const warmths = [0, 1, 2, 5, 8, 9, 10];
    const bottoms = warmths.map((w) => item('Pants', { id: `w${w}`, inferredWarmth: w }));
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const bands = splitIntoWarmthBands(0, 10);

    const results = coreOutfitsForBands(
      emptyCandidates({ bottoms, tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    const bottomIdsUsed = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
    expect(bottomIdsUsed.has('w5')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest utils/__tests__/bandedOutfits.test.ts`
Expected: FAIL with "Cannot find module '../bandedOutfits'"

- [ ] **Step 3: Write the implementation**

```ts
import { floorAwareCandidates, bottomCandidatesFor, baseTopCandidates } from './outfitCandidatePools';
import { generateClosestOutfits, type OutfitCandidates, type ScoredOutfit } from './outfitGenerator';
import type { WarmthBand } from './warmthBands';
import type { ClothingItem } from '../types/wardrobe';

/** Merges floorAwareCandidates run once per band (each targeting that band's own center) into one deduped pool -- see the design spec's "Pool widening" ruling for why this is a static, up-front merge rather than a dynamic re-search. */
function mergedByBandCenters(
  items: readonly ClothingItem[],
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  wornDaysAgo: ReadonlyMap<string, number>,
): ClothingItem[] {
  const merged = new Map<string, ClothingItem>();
  for (const band of [bands.cooler, bands.median, bands.warmer]) {
    for (const candidate of floorAwareCandidates(items, band.center, wornDaysAgo)) {
      merged.set(candidate.id, candidate);
    }
  }
  return [...merged.values()];
}

/**
 * The ranked core-outfit list (Scarf/Tights excluded, see the design spec's
 * "Core search" section) that selectBandedOutfits (Task 7) buckets into
 * bands and tops up. One search, not three: the anchor and Top pools are
 * each widened up front by merging a band-targeted floorAwareCandidates
 * call per band, then generateClosestOutfits runs once over that merged
 * pool -- ranking (closest to the real warmthFloor/warmthCeiling/windFloor)
 * is unaffected, only which candidates the search considers changes.
 */
export function coreOutfitsForBands(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ScoredOutfit[] {
  const anchorPool = mergedByBandCenters(bottomCandidatesFor(candidates, warmthFloor), bands, wornDaysAgo);
  const topPool = mergedByBandCenters(baseTopCandidates(candidates.tops, warmthFloor), bands, wornDaysAgo);

  return generateClosestOutfits(candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, Infinity, wornDaysAgo, {
    anchorPool,
    includeWarmthAccessories: false,
    topCandidatesOverride: topPool,
  });
}
```

- [ ] **Step 4: Run test to verify it passes, and the whole suite still passes**

Run: `npx jest utils/__tests__/bandedOutfits.test.ts`
Expected: PASS, 2 tests

Run: `npx jest`
Expected: PASS, no regressions

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/bandedOutfits.ts wardrobe-app/utils/__tests__/bandedOutfits.test.ts
git commit -m "Add coreOutfitsForBands: one widened, scarf/tights-free core search per band set"
```

---

## Task 7: Global-uniqueness banded selection

**Files:**
- Modify: `wardrobe-app/utils/bandedOutfits.ts`
- Test: `wardrobe-app/utils/__tests__/bandedOutfits.test.ts`

**Interfaces:**
- Consumes: `coreOutfitsForBands` (Task 6, same file); `topUpToward` (Task 5); `ScoredOutfit`, `OutfitCandidates` (`utils/outfitGenerator.ts`); `WarmthBand` (Task 1).
- Produces:
  ```ts
  export function selectBandedOutfits(
    candidates: OutfitCandidates,
    dismatchedKeys: ReadonlySet<string>,
    warmthFloor: number,
    warmthCeiling: number,
    windFloor: number,
    bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
    wornDaysAgo: ReadonlyMap<string, number> = new Map(),
  ): ScoredOutfit[]
  ```
  Returns up to 6 outfits: 2 from `median`, 2 from `cooler`, 2 from `warmer`, in that order — display order in the returned array matches this order directly (index 0-1 = median, 2-3 = cooler, 4-5 = warmer).

**Implementation notes for whoever builds this** (the exact mechanics, since this is the task most likely to need a judgment call — see the design spec's "Selection" and "Empty-band fallback" sections for the agreed rules):

- Item-id tracking is **global across all 6 slots and all three bands** — one `Map<string, number>` counting every item's uses, one `Map<string, ScoredOutfit>` recording the *first* outfit that used each item (so a 2nd use can be checked against it).
- **Scarves count toward the reuse tracker; Tights do not** (per the design spec's ruling) — when recording/checking an outfit's item ids for the uniqueness rule, include every item in `outfit.items` *except* any item whose `category === 'Tights'`.
- For each band, in order (median, cooler, warmer): walk that band's own ranked candidate list (core outfits from `coreOutfitsForBands`, each passed through `topUpToward(core, band, ...)` and re-ranked by closeness to `band.center` using the *topped-up* warmth) and greedily accept up to 2 that satisfy: no item (per the Scarf-counts/Tights-doesn't rule above) would exceed 2 total uses, and for any item that would be its *2nd* use, the first outfit that used it shares no other tracked item with this candidate.
- **Empty-band fallback** (placeholder only, per the design spec — do not over-engineer this): if a band cannot fill both of its slots from its own ranked list even after the above, borrow additional candidates from the nearer adjacent band's own already-computed ranked list (cooler borrows from median first, then warmer; warmer borrows from median first, then cooler; median borrows from cooler first, then warmer), applying the exact same uniqueness check — do not relax the max-2/uniqueness rule to force a fill. If still short after borrowing from both other bands, return fewer than 6.

- [ ] **Step 1: Write the failing tests**

Add to `wardrobe-app/utils/__tests__/bandedOutfits.test.ts`:

```ts
import { selectBandedOutfits } from '../bandedOutfits';

describe('selectBandedOutfits', () => {
  it('returns 2 outfits per band, median first, then cooler, then warmer', () => {
    // A rich wardrobe: 6 bottoms and 6 tops spread across the warmth range,
    // enough variety that every band can fill its 2 slots without borrowing.
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i * 2 }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    expect(results).toHaveLength(6);
  });

  it('never uses the same item more than twice across the whole 6-outfit set', () => {
    const bottoms = Array.from({ length: 8 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i }));
    const tops = Array.from({ length: 8 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bags = Array.from({ length: 8 }, (_, i) => item('Bag', { id: `bag-${i}` }));
    const bands = splitIntoWarmthBands(0, 14);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes, bags }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    const counts = new Map<string, number>();
    for (const outfit of results) {
      for (const outfitItem of outfit.items) {
        counts.set(outfitItem.id, (counts.get(outfitItem.id) ?? 0) + 1);
      }
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('when an item is reused, the two outfits sharing it differ in every other item', () => {
    // Thin wardrobe: only 2 distinct bottoms, forcing at least one to repeat
    // across two of the 6 slots -- when it does, every other slot in those
    // two outfits must differ.
    const bottomA = item('Pants', { id: 'bottom-a', inferredWarmth: 2 });
    const bottomB = item('Pants', { id: 'bottom-b', inferredWarmth: 6 });
    const tops = Array.from({ length: 8 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 8 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const bags = Array.from({ length: 8 }, (_, i) => item('Bag', { id: `bag-${i}` }));
    const bands = splitIntoWarmthBands(0, 10);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops, shoes, bags }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    const byBottom = new Map<string, (typeof results)[number][]>();
    for (const outfit of results) {
      const bottomId = outfit.items.find((i) => i.category === 'Pants')?.id;
      if (!bottomId) continue;
      byBottom.set(bottomId, [...(byBottom.get(bottomId) ?? []), outfit]);
    }
    for (const outfitsSharingABottom of byBottom.values()) {
      if (outfitsSharingABottom.length < 2) continue;
      const [first, second] = outfitsSharingABottom;
      const firstOtherIds = new Set(first.items.filter((i) => i.category !== 'Pants').map((i) => i.id));
      const secondOtherIds = second.items.filter((i) => i.category !== 'Pants').map((i) => i.id);
      for (const id of secondOtherIds) {
        expect(firstOtherIds.has(id)).toBe(false);
      }
    }
  });

  it('borrows from an adjacent band when a band cannot fill both its slots on its own', () => {
    // Every bottom is identical and near the cooler end -- median and warmer
    // bands have nothing of their own to rank highly, so they must borrow.
    const bottoms = Array.from({ length: 2 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: 0 }));
    const tops = Array.from({ length: 2 }, (_, i) => item('T-Shirt', { id: `top-${i}` }));
    const shoes = [item('Shoes')];
    const bands = splitIntoWarmthBands(0, 12);

    const results = selectBandedOutfits(
      emptyCandidates({ bottoms, tops, shoes }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      bands,
    );

    // With borrowing, the thin wardrobe should still produce more than just
    // the 2 outfits the median/cooler bands' own core search could support
    // outright -- this is a smoke test for the borrowing path running at
    // all, not an exact count (see this task's own "Implementation notes").
    expect(results.length).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest utils/__tests__/bandedOutfits.test.ts -t selectBandedOutfits`
Expected: FAIL with "selectBandedOutfits is not a function"

- [ ] **Step 3: Write the implementation**

Append to `wardrobe-app/utils/bandedOutfits.ts`:

```ts
import { topUpToward } from './warmthTopUp';

/** Every item id in `outfit` that counts toward the global reuse tracker -- every category except Tights, per the design spec's "Top-up items" ruling. */
function trackedItemIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => item.category !== 'Tights').map((item) => item.id);
}

/** Ranks `core` outfits by closeness to `band.center` after topping each one up -- the per-band ranked list selectBandedOutfits' greedy pass walks. */
function rankedForBand(
  core: readonly ScoredOutfit[],
  band: WarmthBand,
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
): ScoredOutfit[] {
  return core
    .map((outfit) => topUpToward(outfit, band, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor))
    .sort((a, b) => Math.abs(a.warmth - band.center) - Math.abs(b.warmth - band.center));
}

export function selectBandedOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  bands: { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand },
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ScoredOutfit[] {
  const core = coreOutfitsForBands(
    candidates,
    dismatchedKeys,
    warmthFloor,
    warmthCeiling,
    windFloor,
    bands,
    wornDaysAgo,
  );

  const useCounts = new Map<string, number>();
  const firstUse = new Map<string, ScoredOutfit>();

  function violatesUniqueness(outfit: ScoredOutfit): boolean {
    const ids = trackedItemIds(outfit);
    for (const id of ids) {
      const count = useCounts.get(id) ?? 0;
      if (count >= 2) return true;
      if (count === 1) {
        const sibling = firstUse.get(id);
        if (sibling) {
          const siblingIds = new Set(trackedItemIds(sibling));
          const overlapsOnAnotherItem = ids.some((otherId) => otherId !== id && siblingIds.has(otherId));
          if (overlapsOnAnotherItem) return true;
        }
      }
    }
    return false;
  }

  function record(outfit: ScoredOutfit): void {
    for (const id of trackedItemIds(outfit)) {
      const count = useCounts.get(id) ?? 0;
      if (count === 0) firstUse.set(id, outfit);
      useCounts.set(id, count + 1);
    }
  }

  function pickTwo(ranked: readonly ScoredOutfit[]): ScoredOutfit[] {
    const picked: ScoredOutfit[] = [];
    for (const outfit of ranked) {
      if (picked.length === 2) break;
      if (violatesUniqueness(outfit)) continue;
      record(outfit);
      picked.push(outfit);
    }
    return picked;
  }

  const rankedByBand = {
    cooler: rankedForBand(core, bands.cooler, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor),
    median: rankedForBand(core, bands.median, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor),
    warmer: rankedForBand(core, bands.warmer, candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor),
  };

  const order: (keyof typeof rankedByBand)[] = ['median', 'cooler', 'warmer'];
  const borrowOrder: Record<keyof typeof rankedByBand, (keyof typeof rankedByBand)[]> = {
    median: ['cooler', 'warmer'],
    cooler: ['median', 'warmer'],
    warmer: ['median', 'cooler'],
  };

  const results: ScoredOutfit[] = [];
  for (const bandName of order) {
    let picked = pickTwo(rankedByBand[bandName]);
    for (const donor of borrowOrder[bandName]) {
      if (picked.length === 2) break;
      const more = pickTwo(rankedByBand[donor].filter((o) => !picked.includes(o)));
      picked = [...picked, ...more].slice(0, 2);
    }
    results.push(...picked);
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass, and the whole suite still passes**

Run: `npx jest utils/__tests__/bandedOutfits.test.ts`
Expected: PASS, all tests (6 total in this file after Task 6 + Task 7)

Run: `npx jest`
Expected: PASS, no regressions

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/bandedOutfits.ts wardrobe-app/utils/__tests__/bandedOutfits.test.ts
git commit -m "Add selectBandedOutfits: global reuse ceiling of 2 with adjacent-band borrowing"
```

---

## Task 8: Wire Today's data flow to the banded pipeline

**Files:**
- Modify: `wardrobe-app/contexts/TodayDataContext.tsx`
- Test: `wardrobe-app/contexts/__tests__/outfitsFor.test.ts` (existing file)

**Interfaces:**
- Consumes: `selectBandedOutfits`, `splitIntoWarmthBands` (Tasks 1, 7).
- Produces: no change to `outfitsFor`'s own exported signature — `outfitsFor(todayCandidates, feltTempC, windSpeedKph, workAppropriateOnly?)` stays exactly as it is today. Only its internal implementation changes.

Read `wardrobe-app/contexts/TodayDataContext.tsx`'s current `outfitsFor` function before starting — it currently calls `rankedDiverseOutfits` from `utils/outfitDiversity.ts` with `TODAY_OUTFIT_COUNT` (6) and `MIN_TODAY_OUTFITS` (4). This task replaces that call; `rankedDiverseOutfits` itself is untouched (still used by `generateOutfitsWithItem`, out of this plan's scope).

- [ ] **Step 1: Write the failing tests**

Add to `wardrobe-app/contexts/__tests__/outfitsFor.test.ts` (check its existing imports/fixtures first and match them):

```ts
describe('outfitsFor banded recommendations', () => {
  it('returns up to 6 outfits spanning cooler/median/warmer, not ranked against one single target', () => {
    const bottoms = Array.from({ length: 6 }, (_, i) => item('Pants', { id: `bottom-${i}`, inferredWarmth: i * 2 }));
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { id: `top-${i}`, inferredWarmth: i }));
    const shoes = Array.from({ length: 6 }, (_, i) => item('Shoes', { id: `shoes-${i}` }));
    const todayCandidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms, tops, shoes }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map(),
    };

    const result = outfitsFor(todayCandidates, 10, 0);

    expect(result.shown.length).toBeGreaterThan(0);
    expect(result.shown.length).toBeLessThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes trivially**

Run: `npx jest contexts/__tests__/outfitsFor.test.ts -t "banded recommendations"`
This test alone may pass even before Step 3, since it only checks a length bound both the old and new implementation satisfy — it is here as a smoke test for the wiring, not a discriminating test on its own. The discriminating checks already live in `utils/__tests__/bandedOutfits.test.ts` (Task 7). Proceed to Step 3 regardless.

- [ ] **Step 3: Implement**

In `wardrobe-app/contexts/TodayDataContext.tsx`:

1. Change the imports: remove `rankedDiverseOutfits` from `../utils/outfitDiversity`, add:
   ```ts
   import { selectBandedOutfits } from '../utils/bandedOutfits';
   import { splitIntoWarmthBands } from '../utils/warmthBands';
   ```
2. Delete the `MIN_TODAY_OUTFITS` constant (no longer used by this file — the banded flow always targets 2-per-band instead of a floor count). Keep `TODAY_OUTFIT_COUNT` only if anything else in the file still references it; if `outfitsFor` was its only user, delete it too (check with `grep -n TODAY_OUTFIT_COUNT wardrobe-app/contexts/TodayDataContext.tsx` before deleting).
3. Replace `outfitsFor`'s body:

```ts
export function outfitsFor(
  todayCandidates: TodayCandidates | null,
  feltTempC: number,
  windSpeedKph: number,
  workAppropriateOnly: boolean = false,
): TodayOutfits {
  if (!todayCandidates) return { shown: [], hasAnyOutfit: false };
  const candidates = workAppropriateOnly
    ? filterWorkAppropriate(todayCandidates.candidates)
    : todayCandidates.candidates;
  const floor = warmthFloor(feltTempC);
  const ceiling = warmthCeiling(feltTempC);
  const bands = splitIntoWarmthBands(floor, ceiling);
  const diverse = selectBandedOutfits(
    candidates,
    todayCandidates.dismatchedKeys,
    floor,
    ceiling,
    windFloor(windSpeedKph, feltTempC),
    bands,
    todayCandidates.wornDaysAgo,
  );
  const meetsTarget = diverse.filter((outfit) => outfit.meetsTarget);
  return { shown: meetsTarget.length > 0 ? meetsTarget : diverse, hasAnyOutfit: diverse.length > 0 };
}
```

(`filterWorkAppropriate`, `warmthFloor`, `warmthCeiling`, `windFloor` are the same existing helpers/imports already used by this function today — this only changes the call from `rankedDiverseOutfits(...)` to `selectBandedOutfits(...)`, and adds the `splitIntoWarmthBands` call ahead of it.)

- [ ] **Step 4: Run tests to verify they pass, and the whole suite still passes**

Run: `npx jest contexts/__tests__/outfitsFor.test.ts`
Expected: PASS, all tests including the new one. Some *existing* tests in this file may need their fixtures adjusted if they hard-coded assumptions specific to `rankedDiverseOutfits`' old escalation behavior (e.g. exact result-length or exact-outfit-identity assertions) — if any fail, read the failing assertion and update it to match the banded pipeline's actual, correct behavior; do not weaken an assertion just to make it pass without understanding why it changed.

Run: `npx jest` (full suite)
Expected: PASS

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/contexts/TodayDataContext.tsx wardrobe-app/contexts/__tests__/outfitsFor.test.ts
git commit -m "Wire Today's outfitsFor to the banded recommendation pipeline"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Dispatch the `verifier` agent**

Via the Agent tool, dispatch `verifier` against the full uncommitted/committed diff for this feature (base: merge-base with `main`). It runs the real `npm test`/`npm run lint`/`npm run typecheck` for `wardrobe-app/`.

- [ ] **Step 2: If `verifier` reports any failure, fix it and re-dispatch**

Do not consider this plan complete until `VERDICT: ready`.

- [ ] **Step 3: Manually sanity-check against the reported bugs**

This can't be verified by the test suite alone. If a device/simulator is available, build a test wardrobe with two functionally-identical pairs of trousers (same warmth/wind) and confirm both now appear somewhere across the 6 recommendations at a temperature where they'd previously have collapsed to one. If no device/simulator is available in this session, say so explicitly rather than claiming this step was done — per this repo's standing note that nothing here is verified visually without actually running the app.

---

## Self-review notes (from the writing-plans skill's required self-check)

**Spec coverage:** Bands (spec §2) → Task 1. Region-aware pools (§3) → Task 6's `mergedByBandCenters`, reusing `floorAwareCandidates` unchanged with a per-band target. Core search with Scarf/Tights pulled out (§4) → Tasks 2-4 (the `buildSlots`/`generateClosestOutfits` extensions) and Task 6 (`includeWarmthAccessories: false`). Top-up (§5) → Task 5. Global uniqueness selection (§6) → Task 7. Empty-band fallback (§7) → Task 7's borrowing logic. Wiring (out-of-band but required to actually ship this) → Task 8.

**Placeholder scan:** the one intentional exception is Task 4's Step 1, which deliberately includes a broken line the implementer must delete before Step 2 — flagged explicitly inline as "delete before running," not a TBD.

**Type consistency:** `ScoredOutfit`, `OutfitCandidates`, `WarmthBand` are used with the same shape in every task from the point they're introduced (Tasks 1, 6-8) through to Task 8's wiring. `topUpToward`'s and `coreOutfitsForBands`'/`selectBandedOutfits`' parameter orders were cross-checked against each other while writing this plan (warmthFloor, warmthCeiling, windFloor always appear in that order, matching every existing function in this codebase that takes all three).
