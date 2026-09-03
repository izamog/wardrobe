import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { currentLocation } from '../services/location';
import { fetchTodayForecast, type DailyForecast } from '../services/weather';
import { fetchTodayCandidates, type TodayCandidates } from '../services/outfitGenerator';
import { getLatestLoggedOutfit } from '../services/items';
import { initDatabase, withDb } from '../services/database';
import { warmthCeiling, warmthFloor, windFloor } from '../utils/thermal';
import { selectBandedOutfits } from '../utils/bandedOutfits';
import { splitIntoWarmthBands } from '../utils/warmthBands';
import type { ScoredOutfit } from '../utils/outfitGenerator';
import { todayDateString } from '../utils/date';
import type { ClothingItem } from '../types/wardrobe';
import type { OutfitCandidates } from '../utils/outfitGenerator';

/** Whether outfitsFor found anything to build at all, vs. found candidates but no complete outfit exists. */
export interface TodayOutfits {
  /**
   * Every outfit selectBandedOutfits picked, shown as-is -- not filtered to
   * only the ones that meet today's target. Each band deliberately steers
   * toward its own edge of the valid range (see splitIntoWarmthBands), so a
   * band's own pick legitimately not meeting target is expected and still
   * worth showing, not a reason to hide it (a genuinely extreme day works
   * the same way: nothing lean enough for a heatwave still shows the
   * closest available option rather than an empty screen). Each outfit's
   * own meetsTarget drives its own "Meets target" vs "Closest available
   * (short of target)" label (see OutfitCard in TodayScreen.tsx).
   */
  shown: ScoredOutfit[];
  /** True once the search found at least one complete, valid outfit, whether or not it met target. */
  hasAnyOutfit: boolean;
}

/** Narrows every slot's candidate pool to items marked work appropriate — see outfitsFor's workAppropriateOnly parameter. */
function filterWorkAppropriate(candidates: OutfitCandidates): OutfitCandidates {
  const only = (items: readonly ClothingItem[]) => items.filter((item) => item.isWorkAppropriate);
  return {
    bottoms: only(candidates.bottoms),
    tops: only(candidates.tops),
    shoes: only(candidates.shoes),
    outerwear: only(candidates.outerwear),
    scarves: only(candidates.scarves),
    belts: only(candidates.belts),
    bags: only(candidates.bags),
    tights: only(candidates.tights),
  };
}

/**
 * Up to 6 outfits split into three warmth bands (median, cooler, warmer —
 * 2 each; see utils/bandedOutfits.ts' selectBandedOutfits and
 * utils/warmthBands.ts' splitIntoWarmthBands), with no single item reused
 * more than twice across the whole set. hasAnyOutfit is kept separate from
 * shown.length so the empty state can still tell "closest-available
 * results only" apart from "nothing could be built at all" (see
 * TodayScreen's NoOutfitState).
 *
 * loadToday calls this once, against the real forecast, so TodayScreen's
 * first render never has to run it — see loadToday's own doc comment for why
 * that matters. TodayScreen calls it again only when the troubleshooting
 * slider is actually dragged, against whatever feltTempC/windSpeedKph the
 * slider supplies; both are just different bounds over the same
 * already-fetched candidate pools, not two different features.
 *
 * `previous`, when given alongside `workAppropriateOnly: true`, preserves
 * any of its `shown` outfits whose every item is already work appropriate
 * -- see selectBandedOutfits' alreadyClaimed parameter. Only ever pass a
 * `previous` result that was computed at the same feltTempC/windSpeedKph
 * as this call: those bounds define the bands themselves, so a `previous`
 * from different bounds could hand back outfits that no longer describe
 * today's actual targets.
 */
/**
 * A small, short-lived cache keyed on everything outfitsFor's result
 * actually depends on -- the rounded thermal bounds (thermal.ts's clamp()
 * already rounds warmthFloor/warmthCeiling/windFloor to integers) and the
 * work-appropriate filter. Deliberately small (a few entries) and cleared
 * whenever todayCandidates itself changes identity (a fresh wardrobe/log
 * fetch) -- this only exists to make "drag back to a temperature you were
 * just at" instant within one interaction session, not to guarantee
 * long-term result stability for a given temperature (the underlying
 * search is intentionally Math.random()-jittered; see Task 3d in the prior
 * plan's own design spec).
 *
 * Only consulted/populated when `previous === null`. `previous` carries the
 * filter-stability mechanism's own state (see outfitsFor's own doc
 * comment), and its *content* -- not just whether one was passed -- affects
 * the result: two calls sharing the same thermal bounds and filter can
 * still be given different `previous` values, so a key that only
 * distinguished "has one" from "has none" could silently serve a result
 * computed against the WRONG previous. The cache's actual job (instant
 * re-lookup while dragging the temperature slider) never involves
 * `previous` anyway -- it's only ever passed on a same-bounds,
 * filter-toggle-only call, a narrower path this cache doesn't need to
 * cover.
 */
const OUTFITS_CACHE_MAX_ENTRIES = 8;
let outfitsCacheCandidates: TodayCandidates | null = null;
let outfitsCache: Map<string, TodayOutfits> = new Map();

function outfitsCacheKey(floor: number, ceiling: number, wFloor: number, workAppropriateOnly: boolean): string {
  return `${floor}|${ceiling}|${wFloor}|${workAppropriateOnly}`;
}

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
  // Only cache/consult when there's no `previous` to consider -- `previous`'s
  // own content can differ between calls that otherwise share the same
  // thermal bounds (it carries the filter-toggle-stability mechanism's own
  // state), and a cache key that only distinguished "has one" from "has
  // none" could silently serve a result computed against a DIFFERENT
  // previous value. The cache's actual job (instant re-lookup while
  // dragging the temperature slider) never involves `previous` anyway --
  // that's only ever passed on a same-bounds filter-toggle call.
  const cacheKey = previous === null ? outfitsCacheKey(floor, ceiling, wFloor, workAppropriateOnly) : null;
  if (cacheKey) {
    const cached = outfitsCache.get(cacheKey);
    if (cached) return cached;
  }

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
  // Not filtered to meetsTarget-only: unlike the old single-target ranking,
  // each band deliberately steers toward its own edge of the valid range,
  // so a band's own pick legitimately missing target (especially "warmer",
  // which sits closest to the ceiling) is expected, not a reason to drop
  // it. Reported bug: filtering the whole flat list to meetsTarget-only
  // whenever *any* outfit met target silently dropped the warmer band's
  // own picks whenever they didn't, breaking the promised 2 cooler/2
  // median/2 warmer structure even though selectBandedOutfits had
  // correctly produced it. Each card's own meetsTarget still drives its
  // own "Meets target" vs "Closest available" label (see TodayScreen's
  // OutfitCard) -- nothing here needs the list itself filtered for that
  // to read correctly.
  const result = { shown: diverse, hasAnyOutfit: diverse.length > 0 };

  if (cacheKey) {
    if (outfitsCache.size >= OUTFITS_CACHE_MAX_ENTRIES) {
      const oldestKey = outfitsCache.keys().next().value;
      if (oldestKey !== undefined) outfitsCache.delete(oldestKey);
    }
    outfitsCache.set(cacheKey, result);
  }

  return result;
}

export type TodayLoadState =
  | { step: 'loading' }
  | { step: 'location-denied' }
  | { step: 'weather-unavailable' }
  | { step: 'error' }
  | {
      step: 'ready';
      today: string;
      forecast: DailyForecast;
      /** See fetchTodayCandidates's own doc comment for why this is fetched once, not re-queried per slider move. */
      todayCandidates: TodayCandidates | null;
      /**
       * outfitsFor(todayCandidates, forecast.feltTempC, forecast.windSpeedKph),
       * computed once here rather than by TodayScreen's own first render.
       * selectBandedOutfits runs a full, uncapped search over the whole
       * candidate space (see its own doc comment) — synchronous and, on a
       * closet of any size, slow enough to block the JS thread. Running it
       * during TodayScreen's initial render meant it ran exactly when the
       * user tapped the Today tab, which blocked React Navigation's own
       * screen-transition commit on the same thread — the tab wouldn't even
       * switch until the search finished. Running it here instead means it
       * happens during the background load, before the user has tapped
       * anything, so by the time they do, this is just a state read.
       */
      initialOutfits: TodayOutfits;
      wornToday: ClothingItem[];
    };

async function loadToday(): Promise<TodayLoadState> {
  const today = todayDateString();

  // Location and the forecast don't touch the database at all, so they run
  // immediately, in parallel with initDatabase() below — not after it. Only
  // the last step (the candidate search and the latest logged outfit) needs
  // the database, and that's the only part that waits.
  const [location] = await Promise.all([currentLocation(), initDatabase()]);
  if (!location.ok) {
    // 'unavailable' (no fix, GPS off) is folded into the same message as a
    // denied permission: either way there is nothing to retry without the
    // user doing something outside the app.
    return { step: 'location-denied' };
  }

  const forecast = await fetchTodayForecast(location.coords, today);
  if (!forecast) return { step: 'weather-unavailable' };

  const { todayCandidates, wornToday } = await withDb(async (db) => {
    const [fetched, worn] = await Promise.all([
      fetchTodayCandidates(db, today),
      getLatestLoggedOutfit(db, today),
    ]);
    return { todayCandidates: fetched, wornToday: worn };
  });

  const initialOutfits = outfitsFor(todayCandidates, forecast.feltTempC, forecast.windSpeedKph);

  return { step: 'ready', today, forecast, todayCandidates, initialOutfits, wornToday };
}

/**
 * Re-fetches just the candidate pool and recomputes outfits against the
 * `current` state's already-known forecast — reload()'s location fix and
 * weather call skipped entirely, since neither changes just because an item
 * was edited. Still does the one unavoidably expensive part (outfitsFor's
 * synchronous search), which is exactly why this is called lazily on
 * Today's own focus (see refreshIfStale) rather than eagerly from every
 * screen that writes an item — see invalidate's own doc comment for the
 * reported bug that distinction fixes.
 */
async function refreshCandidates(
  current: Extract<TodayLoadState, { step: 'ready' }>,
): Promise<TodayLoadState> {
  const { todayCandidates, wornToday } = await withDb(async (db) => {
    const [fetched, worn] = await Promise.all([
      fetchTodayCandidates(db, current.today),
      getLatestLoggedOutfit(db, current.today),
    ]);
    return { todayCandidates: fetched, wornToday: worn };
  });
  const initialOutfits = outfitsFor(todayCandidates, current.forecast.feltTempC, current.forecast.windSpeedKph);
  return { ...current, todayCandidates, initialOutfits, wornToday };
}

interface TodayDataContextValue {
  state: TodayLoadState;
  reload: () => void;
  /**
   * Marks the candidate pool stale without doing any work itself — cheap
   * and synchronous, safe to call from any write anywhere in the app.
   *
   * Reported bug (v1): item edits didn't show up in Today until the app was
   * relaunched, since nothing invalidated the pool loadToday computed once
   * at launch. Reported bug (v2): calling the *full* reload() (this
   * function's first version) from every item-writing screen fixed that but
   * froze the app instead — reload() re-runs a live location fix, a live
   * weather fetch, and outfitsFor's synchronous, uncapped search, all
   * inline in whatever save/delete handler triggered it, blocking the JS
   * thread exactly when the user expected a quick screen transition. What
   * the original complaint actually needed was only "stale by the time
   * Today is next shown", not "recomputed the instant something else
   * saves" — invalidate() marks that and defers the real work to
   * refreshIfStale, called from Today's own focus effect, matching how
   * every other screen's useDbQuery already refreshes only when it's
   * actually about to be looked at.
   */
  invalidate: () => void;
  /** No-ops unless invalidate() was called since the last successful load — see invalidate's own doc comment. Call from Today's own focus effect. */
  refreshIfStale: () => void;
  /** Patches wornToday locally after logging, without re-running the rest of loadToday — see TodayScreen's wearOutfit. */
  setWornToday: (outfit: ClothingItem[]) => void;
}

const TodayDataContext = createContext<TodayDataContextValue | null>(null);

/**
 * Loads the Today tab's data once, at app launch, instead of on the tab's own
 * focus. Location, weather and the candidate search are the slow part of
 * this screen, and re-running all three every time the Today tab regains
 * focus is what made switching tabs and back feel slow — the data hasn't
 * gone stale just because another tab was visible. Mounted unconditionally
 * on App.tsx's very first render, before the "Opening your wardrobe…" splash
 * even clears — not behind that screen's own isReady gate, since the
 * location fix and the weather fetch (loadToday's first two steps) don't
 * touch the database at all. Its state survives TodayScreen unmounting when
 * another tab is shown. A screen that legitimately needs to force a full
 * re-fetch (the retry button on a failure state) calls reload() explicitly.
 * Nothing runs automatically on every focus — the one exception is
 * refreshIfStale, which TodayScreen calls on its own focus and which no-ops
 * unless something called invalidate() first (see that function's own doc
 * comment); that's a deliberately narrow exception; it only ever does real
 * work when a write actually happened, not on every ordinary tab switch.
 */
export function TodayDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TodayLoadState>({ step: 'loading' });
  // Bumped on every reload() call and captured per-call below, so a reload
  // that's already in flight when a newer one starts can tell it's stale
  // once it finally resolves and skip applying its (now superseded) result —
  // without this, calling reload() again before the first call's location
  // fix / network round trip finishes (the retry button, or a fast
  // double-tap) could let the first call's late result overwrite the
  // second, newer one.
  const latestRequestId = useRef(0);

  const reload = useCallback(() => {
    const requestId = ++latestRequestId.current;
    setState({ step: 'loading' });
    void loadToday()
      .then((result) => {
        if (latestRequestId.current === requestId) setState(result);
      })
      .catch((e: unknown) => {
        console.error('Failed to load today:', e);
        if (latestRequestId.current === requestId) setState({ step: 'error' });
      });
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A plain ref, not state: setting it must never itself trigger a
  // re-render or any work — see invalidate's own doc comment for why that
  // matters (it's called from arbitrary save/delete handlers all over the
  // app, and has to be free to call from any of them).
  const staleRef = useRef(false);

  const invalidate = useCallback(() => {
    staleRef.current = true;
  }, []);

  const refreshIfStale = useCallback(() => {
    if (!staleRef.current) return;
    setState((current) => {
      if (current.step !== 'ready') return current;
      staleRef.current = false;
      const requestId = ++latestRequestId.current;
      void refreshCandidates(current)
        .then((result) => {
          if (latestRequestId.current === requestId) setState(result);
        })
        .catch((e: unknown) => {
          console.error('Failed to refresh today:', e);
          // Deliberately not setState({step:'error'}) here -- the screen
          // already has a valid, just-possibly-stale `current` to keep
          // showing; a failed background refresh shouldn't blank it.
          if (latestRequestId.current === requestId) staleRef.current = true;
        });
      return current;
    });
  }, []);

  const setWornToday = useCallback((outfit: ClothingItem[]) => {
    setState((current) => (current.step === 'ready' ? { ...current, wornToday: outfit } : current));
  }, []);

  const value = useMemo(
    () => ({ state, reload, invalidate, refreshIfStale, setWornToday }),
    [state, reload, invalidate, refreshIfStale, setWornToday],
  );

  return <TodayDataContext.Provider value={value}>{children}</TodayDataContext.Provider>;
}

export function useTodayData(): TodayDataContextValue {
  const ctx = useContext(TodayDataContext);
  if (!ctx) throw new Error('useTodayData must be used within a TodayDataProvider');
  return ctx;
}
