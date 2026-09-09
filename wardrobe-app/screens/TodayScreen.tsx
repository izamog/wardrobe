import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTodayData, outfitsFor, type TodayOutfits } from '../contexts/TodayDataContext';
import { logOutfitWorn } from '../services/items';
import { withDb } from '../services/database';
import { warmthCeiling, warmthFloor, windFloor } from '../utils/thermal';
import { todayDateString } from '../utils/date';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem } from '../types/wardrobe';
import {
  LocationDeniedState,
  RetryState,
  ForecastSummary,
  WorkAppropriateToggle,
  TodayOutfitBanner,
  NoOutfitState,
  OutfitGrid,
  TroubleshootPanel,
} from './TodayScreenComponents';

export { CollageWithThumbnails } from './TodayScreenComponents';

/**
 * The weather-driven outfit generator (Phase 5).
 *
 * Location -> forecast -> thermal bounds -> generated outfits, in that
 * order, with each step's own honest failure state rather than a spinner
 * that never resolves. The actual fetch (and the initial, real-forecast
 * outfitsFor call — see contexts/TodayDataContext.tsx) lives in
 * contexts/TodayDataContext, loaded once at app launch, not on this screen's
 * focus; this screen only renders whatever state that provider is holding,
 * and only calls outfitsFor itself for the troubleshooting slider's
 * overridden values. See services/location.ts, services/weather.ts,
 * utils/thermal.ts and services/outfitGenerator.ts for the pieces the
 * provider assembles.
 */

export function TodayScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state, reload: reloadTodayData, refreshIfStale, setWornToday } = useTodayData();

  // The one place refreshIfStale is called from -- see its own doc comment.
  // No-ops unless something invalidated the pool since the last load (an
  // item edit, a mark-as-worn, etc.), so this doesn't reintroduce the
  // "recomputes on every ordinary tab switch" slowness reload() was pulled
  // out of the focus path to avoid in the first place.
  useFocusEffect(
    useCallback(() => {
      refreshIfStale();
    }, [refreshIfStale]),
  );
  const [wearingIndex, setWearingIndex] = useState<number | null>(null);
  // null means "use the real forecast" — see effectiveFeltTempC/effectiveWindSpeedKph.
  const [feltTempOverride, setFeltTempOverride] = useState<number | null>(null);
  const [windOverride, setWindOverride] = useState<number | null>(null);
  // Screen-local, not persisted: a filter this deliberate is worth re-choosing
  // each visit rather than silently narrowing recommendations from a toggle
  // set days ago and forgotten about.
  const [workAppropriateOnly, setWorkAppropriateOnly] = useState(false);

  const reload = useCallback(() => {
    setFeltTempOverride(null);
    setWindOverride(null);
    reloadTodayData();
  }, [reloadTodayData]);

  const isReady = state.step === 'ready';
  const effectiveFeltTempC = feltTempOverride ?? (isReady ? state.forecast.feltTempC : 0);
  const effectiveWindSpeedKph = windOverride ?? (isReady ? state.forecast.windSpeedKph : 0);
  const isOverridden = feltTempOverride !== null || windOverride !== null;

  const bounds = useMemo(
    () => ({
      warmthFloor: warmthFloor(effectiveFeltTempC),
      warmthCeiling: warmthCeiling(effectiveFeltTempC),
      windFloor: windFloor(effectiveWindSpeedKph, effectiveFeltTempC),
    }),
    [effectiveFeltTempC, effectiveWindSpeedKph],
  );

  // The common case (no slider override, filter off) reads the ranking the
  // provider already computed in the background — see
  // TodayLoadState.initialOutfits' own doc comment for why this screen must
  // not run outfitsFor itself on every mount. A slider drag or turning the
  // work-appropriate filter on both need a fresh call, for the same reason:
  // either one changes what outfitsFor would return versus what the
  // provider precomputed.
  //
  // lastComputedRef remembers the bounds an outfits value was computed
  // under, so toggling workAppropriateOnly alone (same feltTempC/
  // windSpeedKph as last time) can pass that prior result to outfitsFor as
  // `previous` -- preserving any outfit that's already work appropriate
  // instead of discarding the whole list. A slider drag changes the bounds
  // themselves, so it's never treated as "filter-only" here, and never
  // preserves anything -- see outfitsFor's own doc comment on `previous`
  // for why passing it across different bounds would be wrong.
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
      // This effect synchronizes outfitsState with a deferred, cancelable
      // rAF computation guarded by outfitsGenerationRef (see the comments
      // below) -- it is not mirroring a prop, so an effect is the right
      // tool here, not a render-time state adjustment. The early-return and
      // rAF-scheduled setState calls below are the same synchronization,
      // just on different paths through this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
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
    // the list) while signalling a spinner/dimmed state -- see the
    // "Updating outfits…" indicator below, which reads outfitsState.computing.
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

  const openItem = useCallback(
    (itemId: string) => navigation.navigate('ItemDetails', { itemId }),
    [navigation],
  );

  async function wearOutfit(outfit: readonly ClothingItem[], index: number) {
    setWearingIndex(index);
    try {
      await withDb((db) => logOutfitWorn(db, outfit.map((item) => item.id), todayDateString()));
      // Not reload(): that resets state to 'loading' and re-fetches location,
      // weather and every candidate outfit, which flashes the whole screen
      // back to a spinner just to reflect one write. Only wornToday actually
      // needs to change here.
      setWornToday([...outfit]);
    } catch (e) {
      console.error('Failed to log outfit as worn:', e);
      Alert.alert('Could not save', 'That outfit was not logged as worn.');
    } finally {
      setWearingIndex(null);
    }
  }

  if (state.step === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }

  if (state.step === 'location-denied') return <LocationDeniedState />;
  if (state.step === 'weather-unavailable') {
    return (
      <RetryState
        title="Couldn't fetch today's forecast"
        detail="Check your connection and try again."
        onRetry={reload}
      />
    );
  }
  if (state.step === 'error') {
    return (
      <RetryState
        title="Something went wrong"
        detail="Today's outfits couldn't be loaded. Try again."
        onRetry={reload}
      />
    );
  }

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="p-4">
      {state.wornToday.length > 0 && (
        <TodayOutfitBanner today={state.today} outfit={state.wornToday} onItemPress={openItem} />
      )}

      <ForecastSummary
        forecast={state.forecast}
        warmthFloor={warmthFloor(state.forecast.feltTempC)}
        warmthCeiling={warmthCeiling(state.forecast.feltTempC)}
        windFloor={windFloor(state.forecast.windSpeedKph, state.forecast.feltTempC)}
      />

      <WorkAppropriateToggle value={workAppropriateOnly} onValueChange={setWorkAppropriateOnly} />

      <TroubleshootPanel
        feltTempC={effectiveFeltTempC}
        windSpeedKph={effectiveWindSpeedKph}
        isOverridden={isOverridden}
        onFeltTempChange={setFeltTempOverride}
        onWindChange={setWindOverride}
        onReset={() => {
          setFeltTempOverride(null);
          setWindOverride(null);
        }}
      />

      <View className="mt-4">
        {outfitsState.computing && (
          <View className="flex-row items-center mb-2">
            <ActivityIndicator size="small" />
            <Text className="ml-2 text-xs font-sans-medium text-ink-muted">Updating outfits…</Text>
          </View>
        )}
        {outfits.shown.length === 0 ? (
          <NoOutfitState />
        ) : (
          <OutfitGrid
            outfits={outfits.shown}
            bounds={bounds}
            wearingIndex={wearingIndex}
            onWear={wearOutfit}
            onItemPress={openItem}
          />
        )}
      </View>
    </ScrollView>
  );
}
