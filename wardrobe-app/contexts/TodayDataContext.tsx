import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { currentLocation } from '../services/location';
import { fetchTodayForecast, type DailyForecast } from '../services/weather';
import { fetchTodayCandidates, type TodayCandidates } from '../services/outfitGenerator';
import { getLatestLoggedOutfit } from '../services/items';
import { initDatabase, withDb } from '../services/database';
import { warmthCeiling, warmthFloor, windFloor } from '../utils/thermal';
import { rankedDiverseOutfits } from '../utils/outfitDiversity';
import type { ScoredOutfit } from '../utils/outfitGenerator';
import { todayDateString } from '../utils/date';
import type { ClothingItem } from '../types/wardrobe';
import type { OutfitCandidates } from '../utils/outfitGenerator';

/** The most outfits the Today screen ever recommends at once. */
const TODAY_OUTFIT_COUNT = 6;

/**
 * The fewest weather-appropriate outfits Today tries to show before giving
 * up and showing fewer — see rankedDiverseOutfits' minMeetsTarget for how
 * that's actually enforced (relaxing outfit variety, never the weather
 * bounds, as a last resort). Still just a target, not a guarantee: a
 * wardrobe that truly cannot build this many valid outfits at all still
 * shows fewer, same as before.
 */
const MIN_TODAY_OUTFITS = 4;

/** Whether outfitsFor found anything to build at all, vs. found candidates but none met today's target. */
export interface TodayOutfits {
  /**
   * The outfits to actually show: every one that meets today's target, or —
   * only once none do — the closest available instead, so a genuinely
   * extreme day (nothing lean enough for a heatwave, nothing warm enough
   * for a cold snap) still offers a real recommendation instead of an empty
   * screen telling the user to go find one themselves. Each outfit's own
   * meetsTarget still says which case this is; OutfitCard's "Best match" vs
   * "Closest available (short of target)" label (TodayScreen.tsx) already
   * reads directly off that per outfit, so nothing downstream needed to
   * change to support this falling back.
   */
  shown: ScoredOutfit[];
  /** True once the search found at least one complete, valid outfit, whether or not it met target. */
  hasAnyOutfit: boolean;
}

/**
 * Every outfit the search space could build for a given felt temperature and
 * wind speed, ranked closest to those bounds first and thinned to a varied
 * set (see rankedDiverseOutfits) — capped at TODAY_OUTFIT_COUNT and, so long
 * as the wardrobe can actually support it, never fewer than
 * MIN_TODAY_OUTFITS (see rankedDiverseOutfits' minMeetsTarget) meeting
 * target. hasAnyOutfit is kept separate from shown.length so the empty state
 * can still tell "closest-available fallback" apart from "nothing could be
 * built at all" (see TodayScreen's NoOutfitState).
 *
 * Reported bug: extreme weather — a heatwave with nothing lean enough in the
 * closet, or a cold snap with nothing warm enough — showed "Nothing meets
 * today's target" and stopped there, even though the search had already
 * found real, complete outfits; the user's own request was that an extreme
 * day should "just prepare the warmest/coldest possible outfits" rather than
 * make them go find that fallback themselves via the troubleshoot sliders.
 * shown falls back to the full ranked set exactly when none of it meets
 * target — every member of that fallback set is, by construction, then a
 * genuine closest-available result, which is exactly what the existing
 * "Closest available (short of target)" / "Runner-up N (short of target)"
 * card styling already exists to present; the only change needed here is to
 * stop withholding that set from the screen's default render.
 *
 * loadToday calls this once, against the real forecast, so TodayScreen's
 * first render never has to run it — see loadToday's own doc comment for why
 * that matters. TodayScreen calls it again only when the troubleshooting
 * slider is actually dragged, against whatever feltTempC/windSpeedKph the
 * slider supplies; both are just different bounds over the same
 * already-fetched candidate pools, not two different features.
 */
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
  const diverse = rankedDiverseOutfits(
    candidates,
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
       * rankedDiverseOutfits runs a full, uncapped search over the whole
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

interface TodayDataContextValue {
  state: TodayLoadState;
  reload: () => void;
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
 * another tab is shown. A screen that legitimately needs to force a
 * re-fetch (the retry button on a failure state) calls reload() explicitly;
 * nothing does it automatically on focus.
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

  const setWornToday = useCallback((outfit: ClothingItem[]) => {
    setState((current) => (current.step === 'ready' ? { ...current, wornToday: outfit } : current));
  }, []);

  const value = useMemo(() => ({ state, reload, setWornToday }), [state, reload, setWornToday]);

  return <TodayDataContext.Provider value={value}>{children}</TodayDataContext.Provider>;
}

export function useTodayData(): TodayDataContextValue {
  const ctx = useContext(TodayDataContext);
  if (!ctx) throw new Error('useTodayData must be used within a TodayDataProvider');
  return ctx;
}
