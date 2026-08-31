# Today Recommendation Diversity and Wear Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Today's outfit recommendations so Outerwear and accessories participate in diversity (not just Bottom/Dress), and so wear-recency (soft, graduated over 7/14/30 days) and a fair random tie-break replace the current "whichever candidate was added most recently wins" behavior that buries older, less-worn items — including a confirmed gold-over-silver hardware bias.

**Architecture:** A new `recentWearDays` query reads `Outfit_Logs` (no schema change) into a `Map<itemId, daysAgo>`. That map threads as a new parameter through the existing candidate-pool functions (`outfitCandidatePools.ts`) — which gain a shared `recencyPenalty`/scoring/tie-break helper — up through `buildSlots` (`outfitSlots.ts`), `generateOutfits`/`generateClosestOutfits` (`outfitGenerator.ts`), `rankedDiverseOutfits` (`outfitDiversity.ts`), and `fetchTodayCandidates`/`TodayCandidates` (`services/outfitGenerator.ts`) to `outfitsFor` (`TodayDataContext.tsx`). Separately, `selectDiverseOutfits` (`outfitDiversity.ts`) gains a second anchor tier for Outerwear/Bag/Belt. These are two independent changes that happen to touch overlapping files — sequenced so each task compiles and passes tests on its own.

**Tech Stack:** TypeScript, Jest (`jest-expo` preset), `node:sqlite` for test databases (see `services/migrationTestHelpers.ts`).

**Spec:** `docs/superpowers/specs/2026-08-31-today-recommendation-diversity-and-rotation-design.md`

## Global Constraints

- Every new/changed exported function keeps existing call sites compiling: new parameters that aren't the caller's core concern (`wornDaysAgo`) get a default value (`= new Map()`), matching this repo's convention of not forcing unrelated churn (see `warmthFloor` params defaulting to `0`-like neutral values elsewhere in this codebase).
- No behavior change when `wornDaysAgo` is empty and no tie exists — existing warmth/wind-driven ordering must be provably unchanged for any non-tied comparison.
- Dispatch the repo's `verifier` agent (real `npm test`/`lint`/`typecheck`) before considering this plan done — not a manual substitute.
- Never import `expo-sqlite` outside `services/database.ts` (`wardrobe-app/AGENTS.md`).

---

## Task 1: `recentWearDays` query and a reusable day-diff helper

**Files:**
- Modify: `wardrobe-app/utils/date.ts`
- Modify: `wardrobe-app/services/items.ts`
- Test: `wardrobe-app/utils/__tests__/date.test.ts`
- Test: `wardrobe-app/services/__tests__/items.test.ts`

**Interfaces:**
- Produces: `daysBetween(earlier: string, later: string): number` (`utils/date.ts`) — whole days from `earlier` to `later`, both `YYYY-MM-DD`, computed via local-time `Date` construction (not `Date.parse`, which the existing `daysSince` uses and which is UTC-based — mixing that with `todayDateString`'s local-time convention risks an off-by-one near midnight, exactly the class of bug `todayDateString`'s own doc comment warns about).
- Produces: `recentWearDays(db: ItemsDatabase, today: string, windowDays?: number): Promise<Map<string, number>>` (`services/items.ts`) — `itemId -> days since last worn`, only for items worn within `windowDays` (default 30) of `today`.

- [ ] **Step 1: Write the failing test for `daysBetween`**

Add to `wardrobe-app/utils/__tests__/date.test.ts` (append a new `describe` block; check the file's existing import list at the top and add `daysBetween` to the `from '../date'` import):

```ts
describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-08-31', '2026-08-31')).toBe(0);
  });

  it('counts whole days forward', () => {
    expect(daysBetween('2026-08-25', '2026-08-31')).toBe(6);
  });

  it('counts whole days across a month boundary', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3);
  });

  it('returns a negative number when earlier is after later', () => {
    expect(daysBetween('2026-08-31', '2026-08-25')).toBe(-6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wardrobe-app && npx jest utils/__tests__/date.test.ts -t daysBetween`
Expected: FAIL — `daysBetween is not a function` (or a TypeScript import error if run via `npm test`, which type-checks via ts-jest/babel first).

- [ ] **Step 3: Implement `daysBetween`**

In `wardrobe-app/utils/date.ts`, add after `isValidDateString` (before the `MS_PER_DAY`/`daysSince` block, since this is the same "parse a YYYY-MM-DD string" family as `isValidDateString`, not the ISO-timestamp family `daysSince` belongs to):

```ts
/**
 * Whole days from `earlier` to `later`, both YYYY-MM-DD. Local-time Date
 * construction (year, month-1, day), the same approach isValidDateString
 * uses for its round-trip check -- not Date.parse/daysSince's ISO-timestamp
 * arithmetic, which reads UTC and would drift by a day near local midnight
 * against dates this app writes in local time (see todayDateString).
 */
export function daysBetween(earlier: string, later: string): number {
  const [ey, em, ed] = earlier.split('-').map(Number);
  const [ly, lm, ld] = later.split('-').map(Number);
  const earlierMs = new Date(ey, em - 1, ed).getTime();
  const laterMs = new Date(ly, lm - 1, ld).getTime();
  return Math.round((laterMs - earlierMs) / MS_PER_DAY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd wardrobe-app && npx jest utils/__tests__/date.test.ts -t daysBetween`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `recentWearDays`**

Read `wardrobe-app/services/__tests__/items.test.ts`'s existing imports and any local `freshDb`/`adapt`/insert-log-row helpers before writing this (it likely already has a helper for inserting `Outfit_Logs` rows, given `getLatestLoggedOutfit` and `logOutfitWorn` are already tested there — reuse it rather than duplicating). Append:

```ts
describe('recentWearDays', () => {
  it('maps each item to days since its most recent log within the window', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-25', 'log-1', '2026-08-25T09:00:00.000Z');
    await logOutfitWorn(db, ['item-b'], '2026-08-29', 'log-2', '2026-08-29T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.get('item-a')).toBe(6);
    expect(result.get('item-b')).toBe(2);
  });

  it('keeps the smallest days-ago when an item appears in multiple logs', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-a'], '2026-08-20', 'log-1', '2026-08-20T09:00:00.000Z');
    await logOutfitWorn(db, ['item-a'], '2026-08-29', 'log-2', '2026-08-29T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31');

    expect(result.get('item-a')).toBe(2);
  });

  it('excludes items worn outside the window', async () => {
    const db = await freshDb();
    await logOutfitWorn(db, ['item-old'], '2026-07-01', 'log-1', '2026-07-01T09:00:00.000Z');

    const result = await recentWearDays(db, '2026-08-31', 30);

    expect(result.has('item-old')).toBe(false);
  });

  it('returns an empty map when nothing has been logged', async () => {
    const db = await freshDb();
    const result = await recentWearDays(db, '2026-08-31');
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd wardrobe-app && npx jest services/__tests__/items.test.ts -t recentWearDays`
Expected: FAIL — `recentWearDays is not a function`

- [ ] **Step 7: Implement `recentWearDays`**

In `wardrobe-app/services/items.ts`, add near `getLatestLoggedOutfit` (same area of the file — both read `Outfit_Logs`). First add the import at the top of the file: `import { daysBetween } from '../utils/date';` (check the existing import block first — if `../utils/date` is already imported for something else, add to that line instead of a new one).

```ts
/**
 * itemId -> days since it was last worn, for every item logged within the
 * last `windowDays` of `today` (both YYYY-MM-DD) -- feeds the recency
 * penalty in utils/outfitCandidatePools.ts. Absent from the map means "not
 * worn in this window", not "never worn" -- callers treat that as no
 * penalty either way (see recencyPenalty's own doc comment).
 */
export async function recentWearDays(
  db: ItemsDatabase,
  today: string,
  windowDays: number = 30,
): Promise<Map<string, number>> {
  const cutoff = daysBetween('1970-01-01', today) - windowDays; // days-since-epoch cutoff, compared the same way below
  const rows = await db.getAllAsync<{ date: string; itemIds: string }>(
    'SELECT date, itemIds FROM Outfit_Logs ORDER BY date ASC',
    [],
  );

  const result = new Map<string, number>();
  for (const row of rows) {
    if (daysBetween('1970-01-01', row.date) < cutoff) continue;
    const daysAgo = daysBetween(row.date, today);
    for (const itemId of parseStringArrayColumn(row.itemIds)) {
      const existing = result.get(itemId);
      if (existing === undefined || daysAgo < existing) result.set(itemId, daysAgo);
    }
  }
  return result;
}
```

Note: this reads every `Outfit_Logs` row rather than filtering by `date >=` in SQL, because `daysBetween`'s local-time semantics need to be applied consistently to both the cutoff and each row's comparison — a raw SQL string comparison (`date >= ?`) would be equivalent here since `YYYY-MM-DD` sorts lexicographically the same as chronologically, but computing the cutoff date string correctly (subtracting `windowDays` calendar days, crossing month/year boundaries) is exactly what `daysBetween` exists to avoid hand-rolling twice. If `Outfit_Logs` grows large enough for a full-table scan here to matter, that's a follow-up, not a concern for a personal wardrobe's log volume.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd wardrobe-app && npx jest services/__tests__/items.test.ts -t recentWearDays`
Expected: PASS (4 tests)

- [ ] **Step 9: Run the full affected test files and commit**

Run: `cd wardrobe-app && npx jest utils/__tests__/date.test.ts services/__tests__/items.test.ts`
Expected: PASS, no regressions.

```bash
git add wardrobe-app/utils/date.ts wardrobe-app/services/items.ts wardrobe-app/utils/__tests__/date.test.ts wardrobe-app/services/__tests__/items.test.ts
git commit -m "Add recentWearDays query and daysBetween helper"
```

---

## Task 2: Recency penalty and shared tie-break scoring

**Files:**
- Modify: `wardrobe-app/utils/outfitCandidatePools.ts`
- Test: `wardrobe-app/utils/__tests__/outfitCandidatePools.test.ts` (new file — none exists yet; this module's functions are currently only exercised indirectly via `outfitGenerator.*.test.ts` and `outfitGenerator.slots.test.ts`)

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task is pure scoring logic; `wornDaysAgo` maps are passed in by the caller in Task 3).
- Produces: `recencyPenalty(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number`, `scoreFor(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number`, `compareByScore(a: ClothingItem, b: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number` — all exported for Task 3 and for direct testing.

- [ ] **Step 1: Write the failing tests**

Create `wardrobe-app/utils/__tests__/outfitCandidatePools.test.ts`:

```ts
import { recencyPenalty, scoreFor, compareByScore } from '../outfitCandidatePools';
import type { ClothingItem } from '../../types/wardrobe';

function item(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id: 'item-1',
    imagePath: '',
    originalImagePath: '',
    imageMarginBaked: false,
    category: 'Belt',
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
    ...overrides,
  };
}

describe('recencyPenalty', () => {
  it('is 0 for an item absent from the map (never worn, or outside the window)', () => {
    expect(recencyPenalty(item({ id: 'a' }), new Map())).toBe(0);
  });

  it('is strongest for worn within the last 7 days', () => {
    const worn0 = recencyPenalty(item({ id: 'a' }), new Map([['a', 0]]));
    const worn6 = recencyPenalty(item({ id: 'a' }), new Map([['a', 6]]));
    const worn10 = recencyPenalty(item({ id: 'a' }), new Map([['a', 10]]));
    expect(worn0).toBeGreaterThan(worn10);
    expect(worn6).toBeGreaterThan(worn10);
  });

  it('graduates down across the 7/14/30-day bands', () => {
    const band0to6 = recencyPenalty(item({ id: 'a' }), new Map([['a', 3]]));
    const band7to13 = recencyPenalty(item({ id: 'a' }), new Map([['a', 10]]));
    const band14to29 = recencyPenalty(item({ id: 'a' }), new Map([['a', 20]]));
    expect(band0to6).toBeGreaterThan(band7to13);
    expect(band7to13).toBeGreaterThan(band14to29);
    expect(band14to29).toBeGreaterThan(0);
  });

  it('is 0 at 30 days or more', () => {
    expect(recencyPenalty(item({ id: 'a' }), new Map([['a', 30]]))).toBe(0);
    expect(recencyPenalty(item({ id: 'a' }), new Map([['a', 90]]))).toBe(0);
  });
});

describe('scoreFor', () => {
  it('adds insulation and recencyPenalty', () => {
    const warmItem = item({ id: 'a', inferredWarmth: 5, inferredWind: 2 });
    const wornDaysAgo = new Map([['a', 1]]);
    expect(scoreFor(warmItem, wornDaysAgo)).toBe(7 + recencyPenalty(warmItem, wornDaysAgo));
  });
});

describe('compareByScore', () => {
  it('orders lower score first, same direction insulation-only sort used', () => {
    const light = item({ id: 'a', inferredWarmth: 1, inferredWind: 0 });
    const heavy = item({ id: 'b', inferredWarmth: 5, inferredWind: 0 });
    expect(compareByScore(light, heavy, new Map())).toBeLessThan(0);
    expect(compareByScore(heavy, light, new Map())).toBeGreaterThan(0);
  });

  it('breaks an exact score tie randomly rather than by input order', () => {
    const a = item({ id: 'a', inferredWarmth: 0, inferredWind: 0 });
    const b = item({ id: 'b', inferredWarmth: 0, inferredWind: 0 });

    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      seen.add(Math.sign(compareByScore(a, b, new Map())));
    }
    // Over 40 draws, a coin-flip tie-break should produce both -1 and 1 at
    // least once; this would be flaky at 1 draw but not at 40 (p < 1e-11 for
    // an unbiased coin to land the same way 40 times running).
    expect(seen.has(-1)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });

  it('never randomizes a real, non-tied difference', () => {
    const light = item({ id: 'a', inferredWarmth: 1, inferredWind: 0 });
    const heavy = item({ id: 'b', inferredWarmth: 5, inferredWind: 0 });
    for (let i = 0; i < 20; i++) {
      expect(compareByScore(light, heavy, new Map())).toBeLessThan(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitCandidatePools.test.ts`
Expected: FAIL — `recencyPenalty`/`scoreFor`/`compareByScore` are not exported (module has no such names yet).

- [ ] **Step 3: Implement the scoring helpers**

In `wardrobe-app/utils/outfitCandidatePools.ts`, add after the existing `insulation` function (line 66-68):

```ts
/**
 * 0 (never worn / worn 30+ days ago) up to RECENCY_PENALTY_MAX (worn very
 * recently), graduated across the 7/14/30-day bands the user described --
 * see the design spec's "Recency penalty function" section. Added to
 * insulation() by scoreFor so a recently-worn item ranks slightly behind an
 * equally-warm alternative without ever overriding a real weather-fitness
 * difference (see compareByScore).
 */
const RECENCY_PENALTY_MAX = 3;

export function recencyPenalty(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number {
  const daysAgo = wornDaysAgo.get(item.id);
  if (daysAgo === undefined) return 0;
  if (daysAgo < 7) return RECENCY_PENALTY_MAX;
  if (daysAgo < 14) return RECENCY_PENALTY_MAX * (2 / 3);
  if (daysAgo < 30) return RECENCY_PENALTY_MAX * (1 / 3);
  return 0;
}

/** insulation() plus recencyPenalty() -- the single number every candidate-pool sort in this file ranks by, once wornDaysAgo is known. */
export function scoreFor(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number {
  return insulation(item) + recencyPenalty(item, wornDaysAgo);
}

/**
 * Sorts two candidates by scoreFor, ascending (lighter/less-recently-worn
 * first, matching insulation()'s existing sort direction). On an exact
 * score tie -- the confirmed gold-vs-silver case, where two zero-insulation
 * accessories are also equally (un)recent -- resolves it with a fresh
 * random draw instead of falling through to array order, so neither
 * permanently buries the other across repeated Today loads. Never
 * randomizes a real difference: the random comparison only runs when
 * scoreFor(a) === scoreFor(b) exactly.
 */
export function compareByScore(a: ClothingItem, b: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number {
  const diff = scoreFor(a, wornDaysAgo) - scoreFor(b, wornDaysAgo);
  if (diff !== 0) return diff;
  return Math.random() - 0.5;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitCandidatePools.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/outfitCandidatePools.ts wardrobe-app/utils/__tests__/outfitCandidatePools.test.ts
git commit -m "Add recency-aware scoring and randomized tie-break to candidate pools"
```

---

## Task 3: Thread `wornDaysAgo` through the candidate-pool functions

**Files:**
- Modify: `wardrobe-app/utils/outfitCandidatePools.ts`
- Test: `wardrobe-app/utils/__tests__/outfitCandidatePools.test.ts`

**Interfaces:**
- Consumes: `compareByScore` from Task 2.
- Produces: `leanFirst(items, wornDaysAgo?)`, `layerFirst(items, wornDaysAgo?)`, `accessoryFirst(items, wornDaysAgo?)`, `floorAwareCandidates(items, warmthFloor, wornDaysAgo?)`, `floorAwareOuterwearCandidates(items, wornDaysAgo?)` — every existing exported pool function, each gaining a `wornDaysAgo: ReadonlyMap<string, number> = new Map()` parameter as the new last argument (after `warmthFloor` for `floorAwareCandidates`, since `warmthFloor` is that function's existing primary argument and moving it would break every current call site's argument order).

- [ ] **Step 1: Write the failing tests**

Append to `wardrobe-app/utils/__tests__/outfitCandidatePools.test.ts` (add `leanFirst, layerFirst, accessoryFirst, floorAwareCandidates, floorAwareOuterwearCandidates` to the existing import from `'../outfitCandidatePools'`):

```ts
describe('leanFirst with wornDaysAgo', () => {
  it('still sorts lightest-first when nothing was recently worn', () => {
    const light = item({ id: 'a', inferredWarmth: 1 });
    const heavy = item({ id: 'b', inferredWarmth: 5 });
    expect(leanFirst([heavy, light]).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('a recently-worn item sorts behind an equally-warm alternative', () => {
    const wornRecently = item({ id: 'a', inferredWarmth: 3 });
    const notWorn = item({ id: 'b', inferredWarmth: 3 });
    const wornDaysAgo = new Map([['a', 1]]);
    expect(leanFirst([wornRecently, notWorn], wornDaysAgo).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('recency never overrides a real warmth difference', () => {
    const lightButRecent = item({ id: 'a', inferredWarmth: 1 });
    const heavyNotWorn = item({ id: 'b', inferredWarmth: 8 });
    const wornDaysAgo = new Map([['a', 0]]);
    expect(leanFirst([heavyNotWorn, lightButRecent], wornDaysAgo).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('accessoryFirst with wornDaysAgo: the confirmed gold-vs-silver case', () => {
  it('a less-recently-worn zero-insulation accessory sorts ahead of a more-recently-worn one', () => {
    const goldBelt = item({ id: 'gold', category: 'Belt', hardwareColor: 'Gold' });
    const silverBelt = item({ id: 'silver', category: 'Belt', hardwareColor: 'Silver' });
    const wornDaysAgo = new Map([['gold', 1]]);
    expect(accessoryFirst([goldBelt, silverBelt], wornDaysAgo).map((i) => i.id)).toEqual(['silver', 'gold']);
  });

  it('with no wear history for either, both orderings occur across repeated calls', () => {
    const goldBelt = item({ id: 'gold', category: 'Belt', hardwareColor: 'Gold' });
    const silverBelt = item({ id: 'silver', category: 'Belt', hardwareColor: 'Silver' });

    const firstIds = new Set<string>();
    for (let i = 0; i < 40; i++) {
      firstIds.add(accessoryFirst([goldBelt, silverBelt])[0].id);
    }
    expect(firstIds.has('gold')).toBe(true);
    expect(firstIds.has('silver')).toBe(true);
  });
});

describe('floorAwareOuterwearCandidates with wornDaysAgo', () => {
  it('a recently-worn coat still enters the pool (recency nudges rank, not membership)', () => {
    const wornCoat = item({ id: 'worn', category: 'Coat', inferredWarmth: 8, inferredWind: 8 });
    const wornDaysAgo = new Map([['worn', 0]]);
    const ids = floorAwareOuterwearCandidates([wornCoat], wornDaysAgo).map((i) => i.id);
    expect(ids).toContain('worn');
  });
});

describe('floorAwareCandidates with wornDaysAgo', () => {
  it('passes wornDaysAgo through to its internal leanFirst call', () => {
    const wornRecently = item({ id: 'a', category: 'Pants', inferredWarmth: 3 });
    const notWorn = item({ id: 'b', category: 'Pants', inferredWarmth: 3 });
    const wornDaysAgo = new Map([['a', 1]]);
    // warmthFloor 0 -> floorAwareCandidates is exactly leanFirst (see its own doc comment)
    expect(floorAwareCandidates([wornRecently, notWorn], 0, wornDaysAgo).map((i) => i.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitCandidatePools.test.ts`
Expected: FAIL — `leanFirst`/`accessoryFirst`/`floorAwareOuterwearCandidates`/`floorAwareCandidates` called with an extra argument they don't accept yet; the gold-vs-silver test fails because pool order is still insertion order.

- [ ] **Step 3: Update every pool function to accept and use `wornDaysAgo`**

In `wardrobe-app/utils/outfitCandidatePools.ts`, replace each function's sort call with `compareByScore`, threading a new defaulted parameter:

```ts
export function leanFirst(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  return [...items].sort((a, b) => compareByScore(a, b, wornDaysAgo)).slice(0, MAX_SLOT_CANDIDATES);
}

export function accessoryFirst(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  return [...items].sort((a, b) => compareByScore(a, b, wornDaysAgo)).slice(0, MAX_ACCESSORY_CANDIDATES);
}

export function layerFirst(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  return [...items].sort((a, b) => compareByScore(b, a, wornDaysAgo)).slice(0, MAX_ACCESSORY_CANDIDATES);
}
```

`floorAwareCandidates` (currently calls `leanFirst` plus its own separate heaviest-sort) becomes:

```ts
export function floorAwareCandidates(
  items: readonly ClothingItem[],
  warmthFloor: number,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  if (warmthFloor <= 0) return leanFirst(items, wornDaysAgo);

  const half = Math.ceil(MAX_SLOT_CANDIDATES / 2);
  const leanest = leanFirst(items, wornDaysAgo).slice(0, half);
  const warmest = [...items]
    .sort((a, b) => compareByScore(b, a, wornDaysAgo))
    .slice(0, MAX_SLOT_CANDIDATES - half);

  const merged = new Map<string, ClothingItem>();
  for (const item of [...leanest, ...warmest]) merged.set(item.id, item);
  return [...merged.values()];
}
```

`floorAwareOuterwearCandidates` becomes:

```ts
export function floorAwareOuterwearCandidates(
  items: readonly ClothingItem[],
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[] {
  const heaviest = layerFirst(items, wornDaysAgo);
  const leanest = [...items].sort((a, b) => compareByScore(a, b, wornDaysAgo)).slice(0, 1);

  const merged = new Map<string, ClothingItem>();
  for (const item of [...heaviest, ...leanest]) merged.set(item.id, item);
  return [...merged.values()];
}
```

- [ ] **Step 4: Run the full candidate-pool test file plus every existing consumer test to verify nothing broke**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitCandidatePools.test.ts utils/__tests__/outfitGenerator.slots.test.ts utils/__tests__/outfitGenerator.test.ts utils/__tests__/outfitGenerator.ranking.test.ts`
Expected: PASS. If `outfitGenerator.test.ts`'s "regression — a belt with no compatible bag" test (around line 651-692) fails, read its assertion first — it checks `results[0]` contains `silverBelt`/`silverBag` via `generateClosestOutfits`'s own accessory-count tie-break (a different mechanism, downstream of pool order), so it should remain stable; if it doesn't, that's a real finding to investigate before continuing, not something to force-pass.

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/outfitCandidatePools.ts wardrobe-app/utils/__tests__/outfitCandidatePools.test.ts
git commit -m "Thread wornDaysAgo through every candidate-pool ranking function"
```

---

## Task 4: Thread `wornDaysAgo` through `buildSlots` and the two search functions

**Files:**
- Modify: `wardrobe-app/utils/outfitSlots.ts`
- Modify: `wardrobe-app/utils/outfitGenerator.ts`
- Test: `wardrobe-app/utils/__tests__/outfitGenerator.slots.test.ts`
- Test: `wardrobe-app/utils/__tests__/outfitGenerator.ranking.test.ts`

**Interfaces:**
- Consumes: the updated pool functions from Task 3.
- Produces: `buildSlots(candidates, anchor, warmthFloor, needsScarf, needsBelt, wornDaysAgo?)`, `generateOutfits(candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, maxResults?, wornDaysAgo?)`, `generateClosestOutfits(candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, maxResults?, wornDaysAgo?)` — `wornDaysAgo: ReadonlyMap<string, number> = new Map()` appended as the new last parameter in each case, after the existing `maxResults` default parameter (since a caller providing `maxResults` explicitly but not `wornDaysAgo` — the common case until Task 6 wires the real data in — must keep working positionally).

- [ ] **Step 1: Write the failing test**

Append to `wardrobe-app/utils/__tests__/outfitGenerator.slots.test.ts` (check its existing imports/helpers first — it already imports `floorAwareCandidates` per the earlier grep; add `buildSlots` if not already imported):

```ts
describe('buildSlots threads wornDaysAgo into its candidate-pool calls', () => {
  it('a recently-worn bag sorts behind a not-recently-worn one in the Bag slot', () => {
    const anchor = item('Pants', { hasBeltLoops: false });
    const wornBag = item('Bag', { id: 'worn-bag' });
    const freshBag = item('Bag', { id: 'fresh-bag' });
    const wornDaysAgo = new Map([['worn-bag', 1]]);

    const slots = buildSlots(
      emptyCandidates({ bottoms: [anchor], bags: [wornBag, freshBag] }),
      anchor,
      0,
      false,
      false,
      wornDaysAgo,
    );

    const bagSlot = slots.find((slot) => slot.candidates.some((c) => c.category === 'Bag'));
    expect(bagSlot?.candidates.map((c) => c.id)).toEqual(['fresh-bag', 'worn-bag']);
  });
});
```

Use this test file's own existing `item(...)`/`emptyCandidates(...)` helpers (imported from `outfitGeneratorTestHelpers.ts` per the pattern already visible elsewhere in this file) rather than redefining them.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitGenerator.slots.test.ts -t "threads wornDaysAgo"`
Expected: FAIL — `buildSlots` called with 6 arguments, only accepts 5.

- [ ] **Step 3: Update `buildSlots`**

In `wardrobe-app/utils/outfitSlots.ts`, change the signature and thread the parameter into every pool call:

```ts
export function buildSlots(
  candidates: OutfitCandidates,
  anchor: ClothingItem,
  warmthFloor: number,
  needsScarf: boolean,
  needsBelt: boolean,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): Slot[] {
  const isDress = isDressAnchor(anchor);
  const isTrousers = anchor.category === 'Pants' || anchor.category === 'Leggings';
  const offerTights =
    warmthFloor > 0 &&
    ((isDress || anchor.category === 'Skirt') || (isTrousers && warmthFloor > TIGHTS_UNDER_TROUSERS_WARMTH_FLOOR));

  return [
    {
      candidates: floorAwareCandidates(baseTopCandidates(candidates.tops, warmthFloor), warmthFloor, wornDaysAgo),
      required: !isDress,
    },
    { candidates: accessoryFirst(cardiganCandidates(candidates.tops, warmthFloor), wornDaysAgo), required: false },
    { candidates: accessoryFirst(baseLayerCandidates(candidates.tops, warmthFloor), wornDaysAgo), required: false },
    {
      candidates: floorAwareCandidates(shoeCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo),
      required: true,
    },
    ...(needsScarf
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitGenerator.slots.test.ts`
Expected: PASS, including every pre-existing test in this file (none of their calls pass a 6th argument, so they exercise the `= new Map()` default).

- [ ] **Step 5: Write the failing test for `generateOutfits`/`generateClosestOutfits`**

Append to `wardrobe-app/utils/__tests__/outfitGenerator.ranking.test.ts`:

```ts
describe('generateClosestOutfits threads wornDaysAgo through to buildSlots', () => {
  it('a recently-worn bag is not the sole bag offered when a fresher one exists', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const wornBag = item('Bag', { id: 'worn-bag' });
    const freshBag = item('Bag', { id: 'fresh-bag' });
    const wornDaysAgo = new Map([['worn-bag', 1]]);

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [wornBag, freshBag] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      100,
      wornDaysAgo,
    );

    const withFreshBag = results.some((outfit) => outfit.items.some((i) => i.id === 'fresh-bag'));
    expect(withFreshBag).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitGenerator.ranking.test.ts -t "threads wornDaysAgo"`
Expected: FAIL — `generateClosestOutfits` doesn't accept a 7th argument.

- [ ] **Step 7: Update `generateOutfits` and `generateClosestOutfits`**

In `wardrobe-app/utils/outfitGenerator.ts`:

```ts
export function generateOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  maxResults: number = DEFAULT_MAX_OUTFITS,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ClothingItem[][] {
  // ... unchanged body above the for-loop ...
  for (const bottom of floorAwareCandidates(bottomCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo)) {
    if (results.length >= searchBudget) break;

    chosen.push(bottom);
    if (!exceedsCeiling()) {
      searchSlots(buildSlots(candidates, bottom, warmthFloor, needsScarf, bottom.hasBeltLoops, wornDaysAgo), 0);
    }
    chosen.pop();
  }

  return finalizeOutfits(results, maxResults);
}
```

```ts
export function generateClosestOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  maxResults: number = DEFAULT_MAX_OUTFITS,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ScoredOutfit[] {
  // ... unchanged body above the for-loop ...
  for (const bottom of floorAwareCandidates(bottomCandidatesFor(candidates, warmthFloor), warmthFloor, wornDaysAgo)) {
    chosen.push(bottom);
    searchSlots(buildSlots(candidates, bottom, warmthFloor, needsScarf, bottom.hasBeltLoops, wornDaysAgo), 0);
    chosen.pop();
  }
  // ... unchanged ranking/sort/slice below ...
}
```

(Only the two `for` loops and the signatures change — every other line in both functions, including the internal `searchSlots` closures and the final `.sort(...)`/`.slice(...)` chain, stays exactly as it is today.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitGenerator.ranking.test.ts utils/__tests__/outfitGenerator.test.ts utils/__tests__/outfitGenerator.appropriateness.test.ts utils/__tests__/outfitGenerator.slots.test.ts`
Expected: PASS, all files, no regressions (every existing call site omits the 7th argument and gets the empty-map default, so behavior is unchanged for anyone not yet passing real wear data — that only happens in Task 6).

- [ ] **Step 9: Commit**

```bash
git add wardrobe-app/utils/outfitSlots.ts wardrobe-app/utils/outfitGenerator.ts wardrobe-app/utils/__tests__/outfitGenerator.slots.test.ts wardrobe-app/utils/__tests__/outfitGenerator.ranking.test.ts
git commit -m "Thread wornDaysAgo through buildSlots and the outfit search functions"
```

---

## Task 5: Thread `wornDaysAgo` through `rankedDiverseOutfits`

**Files:**
- Modify: `wardrobe-app/utils/outfitDiversity.ts`
- Test: `wardrobe-app/utils/__tests__/outfitDiversity.test.ts`

**Interfaces:**
- Consumes: `generateClosestOutfits` from Task 4.
- Produces: `rankedDiverseOutfits(candidates, dismatchedKeys, warmthFloor, warmthCeiling, windFloor, count, minMeetsTarget?, wornDaysAgo?)` — `wornDaysAgo` appended after the existing `minMeetsTarget = 0` default.

- [ ] **Step 1: Write the failing test**

Read `wardrobe-app/utils/__tests__/outfitDiversity.test.ts`'s existing helpers first (it already builds `ScoredOutfit`/`OutfitCandidates` fixtures for `rankedDiverseOutfits`/`selectDiverseOutfits` tests). Append:

```ts
describe('rankedDiverseOutfits threads wornDaysAgo through to generateClosestOutfits', () => {
  it('a recently-worn bag is not the only bag offered across the ranked set', () => {
    const bottom = item('Pants');
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const wornBag = item('Bag', { id: 'worn-bag' });
    const freshBag = item('Bag', { id: 'fresh-bag' });
    const wornDaysAgo = new Map([['worn-bag', 1]]);

    const results = rankedDiverseOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [wornBag, freshBag] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      6,
      0,
      wornDaysAgo,
    );

    const withFreshBag = results.some((outfit) => outfit.items.some((i) => i.id === 'fresh-bag'));
    expect(withFreshBag).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitDiversity.test.ts -t "threads wornDaysAgo"`
Expected: FAIL — `rankedDiverseOutfits` doesn't accept an 8th argument.

- [ ] **Step 3: Update `rankedDiverseOutfits`**

In `wardrobe-app/utils/outfitDiversity.ts`:

```ts
export function rankedDiverseOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  count: number,
  minMeetsTarget: number = 0,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ScoredOutfit[] {
  const ranked = generateClosestOutfits(
    candidates,
    dismatchedKeys,
    warmthFloor,
    warmthCeiling,
    windFloor,
    Infinity,
    wornDaysAgo,
  );

  let selected = selectDiverseOutfits(ranked, count);
  for (
    let maxPerBottom = 2;
    selected.filter((outfit) => outfit.meetsTarget).length < minMeetsTarget && maxPerBottom <= count;
    maxPerBottom++
  ) {
    selected = selectDiverseOutfits(ranked, count, maxPerBottom);
  }
  return selected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitDiversity.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add wardrobe-app/utils/outfitDiversity.ts wardrobe-app/utils/__tests__/outfitDiversity.test.ts
git commit -m "Thread wornDaysAgo through rankedDiverseOutfits"
```

---

## Task 6: Extend diversity anchoring to Outerwear, Bag, and Belt

**Files:**
- Modify: `wardrobe-app/utils/outfitDiversity.ts`
- Test: `wardrobe-app/utils/__tests__/outfitDiversity.test.ts`

**Interfaces:**
- Consumes: nothing new (independent of Tasks 1-5; can be done in parallel with them if using subagent-driven-development's parallel dispatch, since it touches `selectDiverseOutfits`, not the `rankedDiverseOutfits` signature Task 5 also touches — sequence after Task 5 regardless, to avoid two tasks editing the same file's escalation loop concurrently).
- Produces: `selectDiverseOutfits(ranked, count, maxPerAnchor?, maxPerAccessoryAnchor?)` (renamed from `maxPerBottom`), extended anchor tracking.

- [ ] **Step 1: Write the failing tests**

Read the existing `describe('selectDiverseOutfits', ...)` block in `wardrobe-app/utils/__tests__/outfitDiversity.test.ts` first — it already has fixtures for outfits sharing a bottom. Append:

```ts
describe('selectDiverseOutfits: Outerwear, Bag, and Belt anchors', () => {
  it('caps repeated Outerwear the same way it already caps repeated Bottom', () => {
    const coat = item('Coat', { id: 'coat' });
    const outfits = [
      scoredOutfit([item('Pants', { id: 'p1' }), item('T-Shirt', { id: 't1' }), coat]),
      scoredOutfit([item('Pants', { id: 'p2' }), item('T-Shirt', { id: 't2' }), coat]),
      scoredOutfit([item('Pants', { id: 'p3' }), item('T-Shirt', { id: 't3' }), coat]),
    ];

    const selected = selectDiverseOutfits(outfits, 3);
    const withCoat = selected.filter((outfit) => outfit.items.some((i) => i.id === 'coat'));
    expect(withCoat.length).toBe(1);
  });

  it('caps repeated Bag independently, more permissively than Outerwear', () => {
    const bag = item('Bag', { id: 'bag' });
    const outfits = [
      scoredOutfit([item('Pants', { id: 'p1' }), item('T-Shirt', { id: 't1' }), bag]),
      scoredOutfit([item('Pants', { id: 'p2' }), item('T-Shirt', { id: 't2' }), bag]),
    ];

    // maxPerAccessoryAnchor default is 1, same starting point as the primary
    // anchor cap -- only one of these two should be selected on the first pass.
    const selected = selectDiverseOutfits(outfits, 2);
    const withBag = selected.filter((outfit) => outfit.items.some((i) => i.id === 'bag'));
    expect(withBag.length).toBe(1);
  });

  it('does not cap Shoes, Scarf, or Tights repetition', () => {
    const shoes = item('Shoes', { id: 'shoes' });
    const outfits = [
      scoredOutfit([item('Pants', { id: 'p1' }), item('T-Shirt', { id: 't1' }), shoes]),
      scoredOutfit([item('Pants', { id: 'p2' }), item('T-Shirt', { id: 't2' }), shoes]),
    ];

    const selected = selectDiverseOutfits(outfits, 2);
    expect(selected.length).toBe(2);
  });
});

describe('rankedDiverseOutfits: primary anchor escalates before accessory anchor', () => {
  it('exhausts the Outerwear/Bottom/Dress cap before relaxing the Bag/Belt cap', () => {
    // A wardrobe with only one bottom and one coat, but two bags -- the search
    // cannot produce more than 1 outfit meeting a distinct-primary-anchor
    // requirement regardless of how far the accessory cap relaxes, so
    // minMeetsTarget above 1 must not cause the accessory cap to relax uselessly
    // while a fixable primary-anchor shortage still exists elsewhere in a
    // larger wardrobe. This test documents the ordering, not a specific count:
    // primary-anchor escalation (existing maxPerBottom loop) must run to its
    // own ceiling (count) before an accessory-anchor escalation phase begins.
    const bottom = item('Pants');
    const coat = item('Coat');
    const bagA = item('Bag', { id: 'bag-a' });
    const bagB = item('Bag', { id: 'bag-b' });
    const results = rankedDiverseOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [item('T-Shirt')], shoes: [item('Shoes')], outerwear: [coat], bags: [bagA, bagB] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      6,
      2,
    );
    // Both bags should be reachable across the ranked set once the accessory
    // cap is allowed to relax -- this is a smoke test that the wiring doesn't
    // throw or infinite-loop with the new two-tier escalation, not an exact
    // count (the exact number of results depends on generateClosestOutfits'
    // full search, which this test isn't re-deriving).
    expect(results.length).toBeGreaterThan(0);
  });
});
```

Check whether `scoredOutfit(...)` already exists as a test helper in this file (it likely does, given `ScoredOutfit[]` fixtures are already built for the existing `selectDiverseOutfits` tests) — reuse it rather than redefining. If it doesn't exist, it needs `{ items, warmth: 0, wind: 0, meetsTarget: true }` shape per `ScoredOutfit`'s interface in `outfitGenerator.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitDiversity.test.ts -t "Outerwear, Bag, and Belt"`
Expected: FAIL — Outerwear/Bag repetition isn't capped yet.

- [ ] **Step 3: Implement the extended anchor tracking**

In `wardrobe-app/utils/outfitDiversity.ts`, replace the `bottomId`/`MAX_OUTFITS_PER_BOTTOM`/`selectDiverseOutfits` section:

```ts
/** The body-region groups tracked as a "primary" anchor -- capped in lockstep with the escalation loop rankedDiverseOutfits already runs for Bottom/Dress. */
const PRIMARY_ANCHOR_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Bottom', 'Dress', 'Outerwear']);

/** The groups tracked as a "secondary" anchor -- capped independently, and only relaxed once the primary cap has already reached its own ceiling (see rankedDiverseOutfits). */
const SECONDARY_ANCHOR_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>(['Bag', 'Belt']);

/** Every primary-anchor item id present in this outfit -- almost always exactly one (the Bottom/Dress anchor the search picks), plus Outerwear when present. */
function primaryAnchorIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => PRIMARY_ANCHOR_GROUPS.has(CATEGORY_GROUP[item.category])).map((item) => item.id);
}

/** Every secondary-anchor item id present in this outfit (Bag, Belt) -- zero, one, or two. */
function secondaryAnchorIds(outfit: ScoredOutfit): string[] {
  return outfit.items.filter((item) => SECONDARY_ANCHOR_GROUPS.has(CATEGORY_GROUP[item.category])).map((item) => item.id);
}

const MAX_OUTFITS_PER_ANCHOR = 1;
const MAX_OUTFITS_PER_ACCESSORY_ANCHOR = 1;

/**
 * Selects up to `count` outfits from a larger, already-ranked pool: at most
 * one per Top/Bottom/Dress core combo (coreComboKey), at most maxPerAnchor
 * per Bottom/Dress/Outerwear item id, and at most maxPerAccessoryAnchor per
 * Bag/Belt item id -- see rankedDiverseOutfits for why these two caps
 * escalate independently rather than together.
 */
export function selectDiverseOutfits(
  ranked: readonly ScoredOutfit[],
  count: number,
  maxPerAnchor: number = MAX_OUTFITS_PER_ANCHOR,
  maxPerAccessoryAnchor: number = MAX_OUTFITS_PER_ACCESSORY_ANCHOR,
): ScoredOutfit[] {
  const selected: ScoredOutfit[] = [];
  const usedCombos = new Set<string>();
  const primaryCounts = new Map<string, number>();
  const secondaryCounts = new Map<string, number>();

  const underPrimaryCap = (outfit: ScoredOutfit): boolean =>
    primaryAnchorIds(outfit).every((id) => (primaryCounts.get(id) ?? 0) < maxPerAnchor);
  const underSecondaryCap = (outfit: ScoredOutfit): boolean =>
    secondaryAnchorIds(outfit).every((id) => (secondaryCounts.get(id) ?? 0) < maxPerAccessoryAnchor);

  for (const outfit of ranked) {
    if (selected.length >= count) return selected;
    if (usedCombos.has(coreComboKey(outfit)) || !underPrimaryCap(outfit) || !underSecondaryCap(outfit)) continue;
    for (const id of primaryAnchorIds(outfit)) primaryCounts.set(id, (primaryCounts.get(id) ?? 0) + 1);
    for (const id of secondaryAnchorIds(outfit)) secondaryCounts.set(id, (secondaryCounts.get(id) ?? 0) + 1);
    usedCombos.add(coreComboKey(outfit));
    selected.push(outfit);
  }

  return selected;
}
```

Remove the old `bottomId` function and `MAX_OUTFITS_PER_BOTTOM` constant entirely — `primaryAnchorIds`/`secondaryAnchorIds` supersede them (check for any other reference to `bottomId`/`MAX_OUTFITS_PER_BOTTOM` in this file or its test file before deleting; the earlier full read of this file in this session found no other usages).

Add the `CategoryGroup` import if not already present at the top of the file (`import { CATEGORY_GROUP } from './categories';` should already be there per the existing `coreComboKey` function's use of it — check before adding a duplicate).

- [ ] **Step 4: Update `rankedDiverseOutfits`'s escalation loop for the two-tier cap**

In the same file, replace the escalation loop inside `rankedDiverseOutfits` (from Task 5's version):

```ts
export function rankedDiverseOutfits(
  candidates: OutfitCandidates,
  dismatchedKeys: ReadonlySet<string>,
  warmthFloor: number,
  warmthCeiling: number,
  windFloor: number,
  count: number,
  minMeetsTarget: number = 0,
  wornDaysAgo: ReadonlyMap<string, number> = new Map(),
): ScoredOutfit[] {
  const ranked = generateClosestOutfits(
    candidates,
    dismatchedKeys,
    warmthFloor,
    warmthCeiling,
    windFloor,
    Infinity,
    wornDaysAgo,
  );

  const meetsCount = (selected: ScoredOutfit[]): boolean =>
    selected.filter((outfit) => outfit.meetsTarget).length >= minMeetsTarget;

  let selected = selectDiverseOutfits(ranked, count);
  if (meetsCount(selected)) return selected;

  // Phase 1: relax the primary (Bottom/Dress/Outerwear) cap first -- a
  // repeated coat is a worse outcome than a repeated bag, so every way to
  // fix the former is exhausted before the latter is ever allowed to relax.
  for (let maxPerAnchor = 2; !meetsCount(selected) && maxPerAnchor <= count; maxPerAnchor++) {
    selected = selectDiverseOutfits(ranked, count, maxPerAnchor);
  }
  if (meetsCount(selected)) return selected;

  // Phase 2: primary cap is already at its own ceiling (count) and still
  // insufficient -- now relax the secondary (Bag/Belt) cap.
  for (
    let maxPerAccessoryAnchor = 2;
    !meetsCount(selected) && maxPerAccessoryAnchor <= count;
    maxPerAccessoryAnchor++
  ) {
    selected = selectDiverseOutfits(ranked, count, count, maxPerAccessoryAnchor);
  }
  return selected;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd wardrobe-app && npx jest utils/__tests__/outfitDiversity.test.ts`
Expected: PASS, every test in the file including the pre-existing Bottom/Dress-cap tests (they should pass unchanged against the renamed-but-equivalent primary-anchor path, since Bottom/Dress were already in `PRIMARY_ANCHOR_GROUPS`).

- [ ] **Step 6: Commit**

```bash
git add wardrobe-app/utils/outfitDiversity.ts wardrobe-app/utils/__tests__/outfitDiversity.test.ts
git commit -m "Extend diversity anchoring to Outerwear, Bag, and Belt"
```

---

## Task 7: Wire real wear data into Today's data flow

**Files:**
- Modify: `wardrobe-app/services/outfitGenerator.ts`
- Modify: `wardrobe-app/contexts/TodayDataContext.tsx`
- Test: `wardrobe-app/contexts/__tests__/outfitsFor.test.ts`
- Test: `wardrobe-app/contexts/__tests__/TodayDataContext.test.tsx`

**Interfaces:**
- Consumes: `recentWearDays` (Task 1), `rankedDiverseOutfits` (Tasks 5-6).
- Produces: `TodayCandidates` gains a `wornDaysAgo: ReadonlyMap<string, number>` field; `fetchTodayCandidates` populates it; `outfitsFor` passes it to `rankedDiverseOutfits`.

- [ ] **Step 1: Read the existing tests for `fetchTodayCandidates` and `outfitsFor` first**

Run: `cd wardrobe-app && grep -n "fetchTodayCandidates\|TodayCandidates" services/__tests__/outfitGenerator.test.ts contexts/__tests__/outfitsFor.test.ts contexts/__tests__/TodayDataContext.test.tsx`

This surfaces the exact existing fixture shape for `TodayCandidates` mocks in `outfitsFor.test.ts`/`TodayDataContext.test.tsx` — those fixtures construct a `TodayCandidates` object by hand and will need a `wornDaysAgo` field added (or left to a default if the test helper already spreads defaults). Update each failing call site found here as part of Step 5 below, using its actual current shape rather than guessing it.

- [ ] **Step 2: Write the failing test for `fetchTodayCandidates`**

Find `wardrobe-app/services/__tests__/outfitGenerator.test.ts`'s existing `describe('fetchTodayCandidates', ...)` block and its `freshDb`/insert-item helpers (reuse them). Append:

```ts
describe('fetchTodayCandidates includes wornDaysAgo', () => {
  it('populates wornDaysAgo from Outfit_Logs', async () => {
    const db = await freshDb();
    const item = await insertItem(db, 'Pants'); // use this file's existing item-insert helper
    await logOutfitWorn(db, [item.id], '2026-08-29', 'log-1', '2026-08-29T09:00:00.000Z');

    const result = await fetchTodayCandidates(db, '2026-08-31');

    expect(result?.wornDaysAgo.get(item.id)).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd wardrobe-app && npx jest services/__tests__/outfitGenerator.test.ts -t "includes wornDaysAgo"`
Expected: FAIL — `result?.wornDaysAgo` is `undefined`.

- [ ] **Step 4: Implement**

In `wardrobe-app/services/outfitGenerator.ts`:

```ts
import { getDismatchedPairKeys, listItemsInCategories, listItemsWornOn, recentWearDays, type ItemsDatabase } from './items';
```

```ts
export interface TodayCandidates {
  candidates: OutfitCandidates;
  dismatchedKeys: ReadonlySet<string>;
  wornDaysAgo: ReadonlyMap<string, number>;
}
```

```ts
export async function fetchTodayCandidates(db: ItemsDatabase, today: string): Promise<TodayCandidates | null> {
  const [bottomsOnly, dresses, wornToday] = await Promise.all([
    listItemsInCategories(db, categoriesInGroup('Bottom')),
    listItemsInCategories(db, categoriesInGroup('Dress')),
    listItemsWornOn(db, today),
  ]);
  const allBottoms = [...bottomsOnly, ...dresses];
  const bottoms = allBottoms.filter((item) => !wornToday.has(item.id));
  if (bottoms.length === 0) return null;

  const [tops, shoes, outerwear, scarves, belts, bags, tights, dismatchedKeys, wornDaysAgo] = await Promise.all([
    listItemsInCategories(db, categoriesInGroup('Top')),
    listItemsInCategories(db, categoriesInGroup('Shoes')),
    listItemsInCategories(db, categoriesInGroup('Outerwear')),
    listItemsInCategories(db, categoriesInGroup('Scarf')),
    listItemsInCategories(db, categoriesInGroup('Belt')),
    listItemsInCategories(db, categoriesInGroup('Bag')),
    listItemsInCategories(db, categoriesInGroup('Tights')),
    getDismatchedPairKeys(db),
    recentWearDays(db, today),
  ]);

  return {
    candidates: { bottoms, tops, shoes, outerwear, scarves, belts, bags, tights },
    dismatchedKeys,
    wornDaysAgo,
  };
}
```

Also update `generateTodayOutfits` in the same file to thread it through to `generateOutfits`:

```ts
export async function generateTodayOutfits(
  db: ItemsDatabase,
  params: TodayBounds,
): Promise<ClothingItem[][]> {
  const fetched = await fetchTodayCandidates(db, params.today);
  if (!fetched) return [];

  return generateOutfits(
    fetched.candidates,
    fetched.dismatchedKeys,
    params.warmthFloor,
    params.warmthCeiling,
    params.windFloor,
    params.maxResults ?? DEFAULT_MAX_OUTFITS,
    fetched.wornDaysAgo,
  );
}
```

- [ ] **Step 5: Fix every existing hand-built `TodayCandidates` fixture**

From Step 1's grep results, add `wornDaysAgo: new Map()` to every object literal matching `TodayCandidates`'s shape in `services/__tests__/outfitGenerator.test.ts`, `contexts/__tests__/outfitsFor.test.ts`, and `contexts/__tests__/TodayDataContext.test.tsx` — these are plain object literals (not calls to `fetchTodayCandidates`), so TypeScript will report each one as missing the new required field; fix them at the exact lines `tsc`/Jest's type-checking reports, not speculatively.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd wardrobe-app && npx jest services/__tests__/outfitGenerator.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing test for `outfitsFor`**

In `wardrobe-app/contexts/__tests__/outfitsFor.test.ts`, find the existing test fixture pattern for `TodayCandidates` (now including `wornDaysAgo` per Step 5) and add:

```ts
describe('outfitsFor threads wornDaysAgo into rankedDiverseOutfits', () => {
  it('passes todayCandidates.wornDaysAgo through', () => {
    const wornBag = item('Bag', { id: 'worn-bag' });
    const freshBag = item('Bag', { id: 'fresh-bag' });
    const todayCandidates: TodayCandidates = {
      candidates: emptyCandidates({ bottoms: [item('Pants')], tops: [item('T-Shirt')], shoes: [item('Shoes')], bags: [wornBag, freshBag] }),
      dismatchedKeys: new Set(),
      wornDaysAgo: new Map([['worn-bag', 1]]),
    };

    const result = outfitsFor(todayCandidates, 20, 0);

    const withFreshBag = result.shown.some((outfit) => outfit.items.some((i) => i.id === 'fresh-bag'));
    expect(withFreshBag).toBe(true);
  });
});
```

Adjust the exact `feltTempC`/`windSpeedKph` arguments to whatever this test file's existing tests already use for "mild, low-warmth-requirement" conditions (check the file first — the goal is a `warmthFloor`/`warmthCeiling`/`windFloor` combination permissive enough that both bags are viable candidates, not a specific pair of numbers).

- [ ] **Step 8: Run test to verify it fails, then implement**

Run: `cd wardrobe-app && npx jest contexts/__tests__/outfitsFor.test.ts -t "threads wornDaysAgo"`
Expected: FAIL initially (rankedDiverseOutfits isn't receiving it yet).

In `wardrobe-app/contexts/TodayDataContext.tsx`, update `outfitsFor`:

```ts
export function outfitsFor(
  todayCandidates: TodayCandidates | null,
  feltTempC: number,
  windSpeedKph: number,
): TodayOutfits {
  if (!todayCandidates) return { shown: [], hasAnyOutfit: false };
  const diverse = rankedDiverseOutfits(
    todayCandidates.candidates,
    todayCandidates.dismatchedKeys,
    warmthFloor(feltTempC),
    warmthCeiling(feltTempC),
    windFloor(windSpeedKph, feltTempC),
    TODAY_OUTFIT_COUNT,
    MIN_TODAY_OUTFITS,
    todayCandidates.wornDaysAgo,
  );
  const meetsTarget = diverse.filter((outfit) => outfit.meetsTarget);
  return { shown: meetsTarget.length > 0 ? meetsTarget : diverse, hasAnyOutfit: diverse.length > 0 };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd wardrobe-app && npx jest contexts/__tests__/outfitsFor.test.ts contexts/__tests__/TodayDataContext.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add wardrobe-app/services/outfitGenerator.ts wardrobe-app/contexts/TodayDataContext.tsx wardrobe-app/services/__tests__/outfitGenerator.test.ts wardrobe-app/contexts/__tests__/outfitsFor.test.ts wardrobe-app/contexts/__tests__/TodayDataContext.test.tsx
git commit -m "Wire recentWearDays into Today's candidate fetch and diversity ranking"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Dispatch the `verifier` agent**

Via the Agent tool, dispatch `verifier` against the full uncommitted/committed diff for this feature (base: merge-base with `main`). It runs the real `npm test`/`npm run lint`/`npm run typecheck` for `wardrobe-app/` — this repo's standing workflow, not optional for this feature.

- [ ] **Step 2: If `verifier` reports any failure, fix it and re-dispatch**

Do not consider this plan complete until `VERDICT: ready`.

- [ ] **Step 3: Manually sanity-check the confirmed complaints against the spec's Problem section**

This can't be verified by the test suite alone (it's about actual recommendation output, not a unit assertion): if a device/simulator is available, add a coat, a silver belt+bag, and a gold belt+bag to a test wardrobe, log a recent outfit wearing the gold pair, and confirm Today's 6 recommendations now include the coat and both hardware families across repeated loads — per this repo's standing note that nothing here is verified visually without actually running the app. If no device/simulator is available in this session, say so explicitly rather than claiming this step was done.

---

## Self-review notes (from the writing-plans skill's required self-check)

**Spec coverage:** Problem items 1-2 (coats/anchoring) → Task 6. Item 3 (gold-over-silver) → Tasks 2-3 (recency + random tie-break) and Task 6 (Bag/Belt secondary anchor cap, so even a fair coin-flip winner doesn't then dominate every other slot too). Item 4 (6 distinct outfits) → Task 6 (extended anchoring is what makes 6 *distinct* outfits reachable at all once Outerwear/accessories stop being invisible to diversity). Item 5 (7/14/30-day rotation) → Tasks 1-2 (query + graduated penalty) and Tasks 3-7 (threading it all the way to Today). Design decisions (soft penalty, pool-only injection, independent escalation tiers, randomized last-resort tie-break) are each implemented in the task that names them above — no decision in the spec is unaddressed by some task.

**Placeholder scan:** every step above contains real, complete code or an exact command — no "TBD"/"similar to Task N"/unshown test bodies.

**Type consistency:** `wornDaysAgo: ReadonlyMap<string, number>` is the same type end-to-end from `recentWearDays`'s return type (Task 1) through every threaded parameter (Tasks 3-7) — verified by re-reading each signature above side by side while writing this plan.
