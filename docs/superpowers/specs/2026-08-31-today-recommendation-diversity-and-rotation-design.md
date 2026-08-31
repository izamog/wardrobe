# Today recommendation diversity and wear rotation

## Problem

User feedback (batch processed via `coding-feedback-intake`, Group E):

1. Coats aren't being recommended — at -1°C, only one fur coat appears across all 6 recommended outfits.
2. The 6 recommended outfits should each be "anchored" on a different piece, generalizing the existing Bottom/Dress-only anchor cap.
3. A specific silver bag + belt combination is rarely recommended.
4. The end goal is 6 distinctly unique outfit recommendations in Today.
5. Recommendations should account for how often pieces were worn in the past 7/14/30 days, to encourage wardrobe rotation.

## Root causes (confirmed by reading the actual code, not assumed)

**Diversity never considers Outerwear or accessories.** `selectDiverseOutfits` (`utils/outfitDiversity.ts`) dedupes only by Top+Bottom+Dress combo (`coreComboKey`) plus a cap of 1 outfit per Bottom/Dress "anchor" (`MAX_OUTFITS_PER_BOTTOM`, escalating to 2, 3... only as a fallback when too few outfits meet the weather target). Outerwear, Bag, and Belt are invisible to this logic entirely — nothing stops the same coat or the same bag from appearing in all 6 outfits.

**Belt/Bag ties are broken by "newest first," not usefulness.** `WARMTH_REGION_WEIGHT`/`WIND_REGION_WEIGHT` (`utils/outfitScoring.ts`) give Bag 0 warmth and 0 wind weight, and Belt 0.1 warmth / 0 wind — both are effectively weather-neutral. `generateClosestOutfits`'s own ranking (`utils/outfitGenerator.ts`) has a documented precedent for exactly this failure mode: its comments describe a previously-reported bug where "a Gold belt with no matching bag kept outranking a Silver belt with one," because once every other tie-break (distance from target, accessory count, warmth) comes up equal, JS's stable sort falls through to "search-encounter order — lean-first," which is set by candidate pool order in `leanFirst`/`accessoryFirst` (`utils/outfitCandidatePools.ts`). Those functions sort by `insulation()` (warmth + wind), which is 0 for every Bag and near-0 for every Belt — so ties are broken by whichever item was inserted into the pool most recently, permanently burying older accessories regardless of actual usage.

**No wear-recency signal exists anywhere in the pipeline**, but the raw data already does: `Outfit_Logs` (`services/items.ts`) stores `date` + `itemIds` (JSON array) per day the user logged an outfit, via `logOutfitWorn`. No schema change is needed — only a new read query.

## Design decisions (confirmed with user during brainstorming)

- **Rotation is a soft penalty, not a hard exclusion.** Weather-fitness stays the non-negotiable constraint; a recently-worn item should rank lower, never disappear outright, so an extreme day with limited valid options still produces a recommendation.
- **Rotation is graduated across the 7/14/30-day windows**, not a single cutoff — worn yesterday is penalized more than worn 20 days ago.
- **Diversity anchor set extends to Outerwear, Bag, and Belt**, alongside the existing Bottom/Dress anchor, using the same "cap at 1, escalate as a last resort" mechanism already in place for Bottom/Dress. Shoes, Scarf, and Tights stay unconstrained.
- **Recency is injected at candidate-pool selection only** (`outfitCandidatePools.ts`), not into `generateClosestOutfits`'s ranking/scoring. For warmth-relevant categories it's a secondary factor blended alongside insulation; for zero-insulation categories (Bag, Belt) it fully replaces the current "newest-first" tie-break, since insulation carries no signal for them at all. This is deliberately the smaller of two viable approaches (the alternative — also injecting recency into `generateClosestOutfits`'s scoring — was discussed and set aside as a follow-up only if pool-level reshaping proves insufficient in practice, per YAGNI).

## Design

### 1. New query: recent wear history

`services/items.ts` gets a new function:

```ts
/** itemId -> days since it was last worn, for every item worn within the last 30 days. Absent = not worn in that window. */
export async function recentWearDays(db: ItemsDatabase, today: string, windowDays: number = 30): Promise<Map<string, number>>
```

Implementation: one query against `Outfit_Logs` for `date >= (today - windowDays)`, grouped by item id, taking the most recent `date` per item, converted to "days ago" relative to `today`. `Outfit_Logs.itemIds` is a JSON array (same decode path `getLatestLoggedOutfit` already uses via `parseStringArrayColumn`), so this iterates logged rows in the window and folds them into a `Map<itemId, daysAgo>`, keeping the smallest `daysAgo` per item if it appears in multiple rows.

### 2. Recency penalty function

New in `utils/outfitCandidatePools.ts` (or a new small module if it grows — start colocated since it's one function used only here):

```ts
/** 0 (just worn) to RECENCY_PENALTY_MAX (unworn in window or never worn), graduated across the 7/14/30-day bands. */
function recencyPenalty(item: ClothingItem, wornDaysAgo: ReadonlyMap<string, number>): number
```

A simple banded function, not a continuous curve — matches the graduated-but-simple shape the user asked for:
- Worn 0–6 days ago: strongest penalty.
- Worn 7–13 days ago: medium penalty.
- Worn 14–29 days ago: light penalty.
- Worn 30+ days ago, or never: 0 (no penalty).

Exact magnitudes are tuned during implementation/verification, not fixed here — the shape (graduated, disappearing by 30 days) is the spec; the numbers are an implementation detail checked against real behavior, the same way existing adjustment tables in `utils/warmth.ts` were tuned.

### 3. Candidate pool changes

`leanFirst`, `layerFirst`, `accessoryFirst`, and `floorAwareOuterwearCandidates` (`utils/outfitCandidatePools.ts`) all currently sort by `insulation(item)` alone. Each gains a `wornDaysAgo: ReadonlyMap<string, number>` parameter (threaded through from `fetchTodayCandidates`, which already assembles `OutfitCandidates` once per Today load — see below) and sorts by:

```ts
insulation(item) + recencyPenalty(item, wornDaysAgo)
```

For a normal warmth-relevant item, this nudges rank without overriding weather-fitness — a recently-worn coat still sorts near other similarly-warm coats, just slightly behind an equally-warm alternative. For Bag/Belt, `insulation()` is 0 for every candidate, so `recencyPenalty` alone determines order — replacing "newest-first" with "least-recently-worn-first," which directly fixes the silver bag/belt burial (per the confirmed root cause: pool order is what search-encounter-order tie-breaks in `generateClosestOutfits` ultimately fall back to).

`MAX_SLOT_CANDIDATES`/`MAX_ACCESSORY_CANDIDATES` caps are unchanged — this changes *which* items make each cut, not how many.

### 4. Diversity anchor extension

`utils/outfitDiversity.ts`: generalize the existing single-purpose `bottomId`/`MAX_OUTFITS_PER_BOTTOM` mechanism into a small set of tracked anchor categories:

```ts
const ANCHOR_GROUPS: ReadonlySet<CategoryGroup> = new Set(['Bottom', 'Dress', 'Outerwear']);
```

`selectDiverseOutfits` tracks two independent count maps, both keyed by item id:

- **Primary anchors** (Bottom, Dress, Outerwear): capped at `maxPerAnchor`, the direct rename of today's `maxPerBottom` parameter — same escalation shape, just counting three groups' item ids instead of one.
- **Secondary anchors** (Bag, Belt): capped at a separate `maxPerAccessoryAnchor`, starting at 1.

`rankedDiverseOutfits`'s existing escalation loop (which currently raises `maxPerBottom` from 1 upward when too few outfits meet `minMeetsTarget`) escalates `maxPerAnchor` first, exactly as it does today. Only once `maxPerAnchor` has been raised to `count` (its own ceiling, per the existing loop condition) without producing enough matching outfits does a second escalation phase begin raising `maxPerAccessoryAnchor`. This ordering is the point: an outfit repeating its coat is a worse outcome than one repeating its bag, so the search exhausts every way to fix the former before it's ever allowed to relax the latter.

### 5. Wiring

`fetchTodayCandidates` (`services/outfitGenerator.ts`) — not yet read in full this session; will be read before implementation — is where `OutfitCandidates` is assembled once per Today load (per `TodayDataContext.tsx`'s doc comments on why this is fetched once, not per-render). This is the natural place to also fetch `recentWearDays` once and pass it down into whichever pool-selection calls it feeds, keeping the "one fetch per Today load" invariant `TodayDataContext.tsx` already documents intact — no new fetch triggered by re-renders or slider drags.

## Testing

- `services/__tests__/items.test.ts`: `recentWearDays` — multiple log rows, same item logged twice (keeps the more recent), items outside the window excluded, empty log table.
- `utils/__tests__/outfitCandidatePools.test.ts` (new, or added to existing materials/warmth-adjacent test file — check for an existing one before creating): `leanFirst`/`layerFirst`/`accessoryFirst` ordering shifts correctly given a `wornDaysAgo` map, including the zero-insulation (Bag/Belt) case where recency becomes the sole determinant.
- `utils/__tests__/outfitDiversity.test.ts`: extend existing coverage — an outfit set with repeated Outerwear/Bag/Belt across the 6 gets thinned the same way repeated Bottom/Dress already does; confirm Bag/Belt's independent, more-permissive escalation doesn't block on the Bottom/Dress/Outerwear cap.
- `verifier` dispatch (real `npm test`/`lint`/`typecheck`) before considering this done, per this repo's standing workflow — no manual exception for this feature.

## Out of scope (deliberately)

- Injecting recency into `generateClosestOutfits`'s ranking/scoring directly (Approach 2 from brainstorming) — revisit only if pool-level reshaping proves insufficient once tried against real data.
- Any UI surfacing of "why was this recommended" or wear-recency indicators in the Today screen — not requested.
- Changing `MAX_SLOT_CANDIDATES`/`MAX_ACCESSORY_CANDIDATES` — the caps themselves aren't the problem; ordering within them is.
