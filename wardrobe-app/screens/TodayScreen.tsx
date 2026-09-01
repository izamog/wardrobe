import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { OutfitCollage } from '../components/OutfitCollage';
import { StoredImage } from '../components/StoredImage';
import { useTodayData, outfitsFor } from '../contexts/TodayDataContext';
import type { DailyForecast } from '../services/weather';
import { logOutfitWorn } from '../services/items';
import { withDb } from '../services/database';
import { warmthCeiling, warmthFloor, windFloor } from '../utils/thermal';
import type { ScoredOutfit } from '../utils/outfitGenerator';
import { LEG_WARMTH_FLOOR_FRACTION, TORSO_WARMTH_FLOOR_FRACTION, legWarmth, torsoWarmth } from '../utils/outfitScoring';
import { todayDateString } from '../utils/date';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem } from '../types/wardrobe';

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

function LocationDeniedState() {
  return (
    <View className="flex-1 bg-paper">
      <EmptyState
        title="Location needed"
        detail="Wardrobe uses your location to fetch today's forecast. You can turn it on in Settings."
      />
      <View className="p-4">
        <Pressable
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          className="rounded-sm py-3.5 items-center bg-ink"
        >
          <Text className="text-paper font-sans-medium">Open Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RetryState({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <View className="flex-1 bg-paper">
      <EmptyState title={title} detail={detail} />
      <View className="p-4">
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="rounded-sm py-3.5 items-center bg-ink"
        >
          <Text className="text-paper font-sans-medium">Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ForecastSummary({
  forecast,
  warmthFloor,
  warmthCeiling,
  windFloor,
}: {
  forecast: DailyForecast;
  warmthFloor: number;
  warmthCeiling: number;
  windFloor: number;
}) {
  return (
    <View className="bg-paper-2 rounded-sm p-5">
      <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted">Today</Text>
      {/* Big statistics number, above the large-size threshold: Public Sans 400, not 300. */}
      <Text className="text-4xl font-sans text-ink mt-1">{Math.round(forecast.tempC)}°C</Text>
      <Text className="text-sm font-sans text-ink-muted">
        Feels like {Math.round(forecast.feltTempC)}°C · {Math.round(forecast.windSpeedKph)}kph wind
      </Text>
      <View className="h-px bg-rule my-4" />
      <Text className="text-sm font-sans text-ink-muted">
        Warmth needs to land between {warmthFloor} and {warmthCeiling} · Wind needs at least{' '}
        {windFloor}
      </Text>
      {/* Not "out of 10" here on purpose: these are bounds on an outfit's
          summed, weighted total (utils/thermal.ts), which routinely runs
          past 10 once more than one garment counts toward it — they aren't
          on the same 0-10 scale a single item's own score is. */}
      <Text className="text-xs font-sans text-ink-muted mt-1">
        Both are outfit totals, not a 0-10 score — a warmth floor of 0 means no extra layer is
        needed today, and the ceiling is what stops warm enough from becoming too warm.
      </Text>
    </View>
  );
}

/** A single toggle: when on, Today's recommendations are built only from items marked work appropriate — see outfitsFor's workAppropriateOnly parameter. */
function WorkAppropriateToggle({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View className="flex-row items-center justify-between bg-paper-2 rounded-sm px-5 py-4 mt-3">
      <Text className="text-sm font-sans-medium text-ink">Work appropriate only</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

/**
 * A tappable thumbnail — opens the item's own details screen.
 *
 * showScores exposes each item's own warmth/wind contribution, not just the
 * outfit's total: a total alone doesn't say which piece is the outlier
 * dragging it up, which is exactly what's needed to troubleshoot a
 * surprising recommendation. Off by default (the "wearing today" banner
 * doesn't need it) so it only shows where it's useful.
 */
function OutfitThumbnail({
  item,
  onPress,
  showScores = false,
}: {
  item: ClothingItem;
  onPress: () => void;
  showScores?: boolean;
}) {
  return (
    // Borderless, same as ItemGrid's photo cells and OutfitCollage — see design.md's
    // box-in-box rule.
    <Pressable onPress={onPress} accessibilityRole="button" className="w-16 mr-2">
      <View className="aspect-[3/4] overflow-hidden bg-paper">
        <StoredImage path={item.imagePath} hasBakedMargin={item.imageMarginBaked} placeholder="No photo" />
      </View>
      <Text className="text-xs font-sans text-ink-muted mt-1" numberOfLines={1}>
        {item.category}
      </Text>
      {showScores && (
        <Text className="text-xs font-sans text-ink-muted" numberOfLines={1}>
          W{item.inferredWarmth} · Wd{item.inferredWind}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The collage plus the same per-item thumbnails OutfitThumbnail already
 * renders individually tappable — the collage overlaps pieces too much to
 * make each one its own reliable tap target, so the thumbnail row underneath
 * is what stays tappable to an item's own detail screen, always visible
 * rather than behind a tap.
 */
export function CollageWithThumbnails({
  items,
  onItemPress,
  showScores = false,
}: {
  items: readonly ClothingItem[];
  onItemPress: (itemId: string) => void;
  showScores?: boolean;
}) {
  return (
    <View>
      <OutfitCollage items={items} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
        {items.map((item) => (
          <OutfitThumbnail key={item.id} item={item} onPress={() => onItemPress(item.id)} showScores={showScores} />
        ))}
      </ScrollView>
    </View>
  );
}

/** Pinned at the top once an outfit has been logged today, next to the date. */
function TodayOutfitBanner({
  today,
  outfit,
  onItemPress,
}: {
  today: string;
  outfit: ClothingItem[];
  onItemPress: (itemId: string) => void;
}) {
  return (
    <View className="border-b border-rule pb-4 mb-4">
      <Text className="text-xs font-sans-medium uppercase tracking-wide text-accent mb-3">Wearing today · {today}</Text>
      <CollageWithThumbnails items={outfit} onItemPress={onItemPress} />
    </View>
  );
}

/**
 * All four checks meetsTarget actually depends on, always shown, each
 * individually marked pass or fail — not just on a card that misses target.
 *
 * Reported confusion this replaces: the old version only rendered on a
 * failing card, and only ever showed the leg/torso region numbers — so a
 * card whose real failure reason was the *ceiling* (e.g. warmth 6 against a
 * needs-0-5 range) still showed region numbers that both trivially passed
 * (a 0 warmthFloor means a 0+ region requirement), giving no indication
 * ceiling was the actual problem and reading as if the app had a bug. And a
 * passing card showed nothing at all, so there was no way to double-check a
 * "Meets target" card's own numbers the way a failing card's could be
 * inspected. Every check is shown for every card now, and each is coloured
 * by whether *that specific check* passes — not by the card's overall
 * meetsTarget — so a viewer can see exactly which bound(s), if any, an
 * outfit actually fails.
 *
 * Outerwear intentionally contributes nothing to torsoWarmth (see
 * meetsTorsoFloor's own doc comment in outfitScoring.ts) — a warm jacket
 * over a bare-legged, thin dress can score well on whole-outfit warmth
 * while still failing the torso floor, which is exactly what this is meant
 * to make visible rather than leave as an unexplained rejection.
 */
function OutfitDiagnostics({
  outfit,
  warmthFloor,
  warmthCeiling,
  windFloor,
}: {
  outfit: ScoredOutfit;
  warmthFloor: number;
  warmthCeiling: number;
  windFloor: number;
}) {
  const legTarget = warmthFloor * LEG_WARMTH_FLOOR_FRACTION;
  const torsoTarget = warmthFloor * TORSO_WARMTH_FLOOR_FRACTION;
  const legs = legWarmth(outfit.items);
  const torso = torsoWarmth(outfit.items);

  const warmthOk = outfit.warmth >= warmthFloor && outfit.warmth <= warmthCeiling;
  const windOk = outfit.wind >= windFloor;
  const legsOk = legs >= legTarget;
  const torsoOk = torso >= torsoTarget;

  const checkClass = (ok: boolean) => (ok ? 'text-ink-muted' : 'text-amber-700');

  return (
    <View className="mt-2">
      <Text className="text-xs font-sans text-ink-muted">
        <Text className={checkClass(warmthOk)}>
          Warmth {outfit.warmth.toFixed(1)} (needs {warmthFloor}-{warmthCeiling})
        </Text>
        {' · '}
        <Text className={checkClass(windOk)}>
          Wind {outfit.wind.toFixed(1)} (needs {windFloor}+)
        </Text>
      </Text>
      <Text className="text-xs font-sans text-ink-muted mt-1">
        <Text className={checkClass(legsOk)}>
          Legs {legs.toFixed(1)} (needs {legTarget.toFixed(1)}+)
        </Text>
        {' · '}
        <Text className={checkClass(torsoOk)}>
          Torso {torso.toFixed(1)} (needs {torsoTarget.toFixed(1)}+)
        </Text>
      </Text>
    </View>
  );
}

/** The heading shown above each band's own pair of cards — see selectBandedOutfits (utils/bandedOutfits.ts), display order median/cooler/warmer. */
const BAND_HEADING: Record<'median' | 'cooler' | 'warmer', string> = {
  median: 'Just right',
  cooler: 'Cooler option',
  warmer: 'Warmer option',
};

/** The badge text for an OutfitCard — split out to keep OutfitCard's own complexity down. */
function outfitCardLabel(meetsTarget: boolean): string {
  return meetsTarget ? 'Meets target' : 'Closest available (short of target)';
}

/**
 * One outfit within a band's own group of (up to) two cards. Bands are no
 * longer ranked against each other by distance-from-target — each is a
 * deliberate warmth choice (see selectBandedOutfits) — so a card's own
 * meetsTarget is the only thing that still varies its badge/border; there
 * is no single "best match" to compare the rest against any more.
 */
function OutfitCard({
  outfit,
  warmthFloor,
  warmthCeiling,
  windFloor,
  wearing,
  onWear,
  onItemPress,
}: {
  outfit: ScoredOutfit;
  warmthFloor: number;
  warmthCeiling: number;
  windFloor: number;
  wearing: boolean;
  onWear: () => void;
  onItemPress: (itemId: string) => void;
}) {
  const { meetsTarget } = outfit;
  const label = outfitCardLabel(meetsTarget);
  // No card chrome (see design.md's box-in-box rule) — outfits are
  // separated by whitespace and a hairline rule beneath each, not by a
  // bordered white box around an already-bordered collage.
  return (
    <View style={{ width: '48%' }} className="pb-4 mb-4 border-b border-rule">
      <View className="flex-row items-center mb-2">
        <Text
          className={`text-xs font-sans uppercase tracking-wide ${meetsTarget ? 'text-accent' : 'text-ink-muted'}`}
        >
          {label}
        </Text>
      </View>
      <CollageWithThumbnails items={outfit.items} onItemPress={onItemPress} showScores />
      {/* One decimal place, not rounded to a whole number: a whole-number
          display let a real shortfall (e.g. 6.6 against a windFloor of 7)
          read as "meets it" once both sides rounded to the same integer —
          a reported source of confusion about why a card wasn't a Best
          match despite the numbers looking exactly right. */}
      <OutfitDiagnostics outfit={outfit} warmthFloor={warmthFloor} warmthCeiling={warmthCeiling} windFloor={windFloor} />
      <Pressable
        onPress={onWear}
        disabled={wearing}
        accessibilityRole="button"
        className={`rounded-sm py-3 items-center mt-3 ${wearing ? 'bg-rule' : 'bg-accent'}`}
      >
        <Text className="text-paper font-sans-medium">{wearing ? 'Saving…' : 'Wear this outfit'}</Text>
      </Pressable>
    </View>
  );
}

function NoOutfitState() {
  return (
    <EmptyState
      title="No outfit can be built at all"
      detail="Add items in the missing category, or rate more pairs on the Match tab so more combinations are considered — the weather bounds aren't the issue here, nothing complete exists yet."
    />
  );
}

const BAND_ORDER: ('median' | 'cooler' | 'warmer')[] = ['median', 'cooler', 'warmer'];

/**
 * The recommended outfits, grouped into their band sections (median, then
 * cooler, then warmer — see BAND_ORDER/selectBandedOutfits) rather than one
 * flat, distance-ranked grid. `index` passed to onWear/wearing is the
 * outfit's position in the original flat `outfits` array (not its position
 * within its band section), since that's what TodayScreen's wearingIndex
 * state and wearOutfit call already key off.
 */
function OutfitGrid({
  outfits,
  bounds,
  wearingIndex,
  onWear,
  onItemPress,
}: {
  outfits: ScoredOutfit[];
  bounds: { warmthFloor: number; warmthCeiling: number; windFloor: number };
  wearingIndex: number | null;
  onWear: (outfit: readonly ClothingItem[], index: number) => void;
  onItemPress: (itemId: string) => void;
}) {
  const indexed = outfits.map((outfit, index) => ({ outfit, index }));
  const unbanded = indexed.filter((entry) => entry.outfit.band === undefined);

  function renderCards(entries: { outfit: ScoredOutfit; index: number }[]) {
    return entries.map(({ outfit, index }) => (
      <OutfitCard
        key={outfit.items.map((item) => item.id).join('|')}
        outfit={outfit}
        warmthFloor={bounds.warmthFloor}
        warmthCeiling={bounds.warmthCeiling}
        windFloor={bounds.windFloor}
        wearing={wearingIndex === index}
        onWear={() => onWear(outfit.items, index)}
        onItemPress={onItemPress}
      />
    ));
  }

  return (
    <View>
      {BAND_ORDER.map((bandName) => {
        const entries = indexed.filter((entry) => entry.outfit.band === bandName);
        if (entries.length === 0) return null;
        return (
          <View key={bandName} className="mb-2">
            <Text className="text-xs font-sans-medium uppercase tracking-wide text-ink-muted mb-2">
              {BAND_HEADING[bandName]}
            </Text>
            <View className="flex-row flex-wrap justify-between">{renderCards(entries)}</View>
          </View>
        );
      })}
      {/* Every outfit outfitsFor produces is tagged with a band (see
          selectBandedOutfits) -- this only renders if some future caller of
          OutfitGrid ever passes an untagged ScoredOutfit, so nothing is
          silently dropped rather than shown. */}
      {unbanded.length > 0 && <View className="flex-row flex-wrap justify-between">{renderCards(unbanded)}</View>}
    </View>
  );
}

/**
 * Lets the slider values sit a bit apart from the real forecast without
 * running off into nonsense — an unbounded slider drags is where a bogus
 * warmth/wind computation would actually come from, not from thermal.ts's own
 * math, which is fine at any input.
 */
const FELT_TEMP_MIN_C = -15;
const FELT_TEMP_MAX_C = 35;
const WIND_MIN_KPH = 0;
const WIND_MAX_KPH = 80;

/**
 * The feels-like temperature and wind sliders that drive outfitsFor below —
 * "what would today's recommendation be at a different temperature or wind
 * speed", for troubleshooting a surprising or empty result without waiting
 * for the weather to actually change. Collapsed by default so it doesn't
 * compete with the actual recommendation for attention.
 *
 * onFeltTempChange/onWindChange only fire once a drag ends (Slider's
 * onSlidingComplete), not on every tick of the drag (onValueChange) —
 * generateClosestOutfits is a full, uncapped search of the whole candidate
 * space (see its own doc comment in utils/outfitGenerator.ts), and running
 * it dozens of times a second while a finger moves across the slider is what
 * made dragging feel laggy. live* below is purely a local display value so
 * the label and thumb still track the finger in real time; it's kept in sync
 * with the committed feltTempC/windSpeedKph whenever those change from
 * elsewhere (a reset, or the initial forecast load).
 */
function TroubleshootPanel({
  feltTempC,
  windSpeedKph,
  isOverridden,
  onFeltTempChange,
  onWindChange,
  onReset,
}: {
  feltTempC: number;
  windSpeedKph: number;
  isOverridden: boolean;
  onFeltTempChange: (value: number) => void;
  onWindChange: (value: number) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [liveFeltTempC, setLiveFeltTempC] = useState(feltTempC);
  const [liveWindSpeedKph, setLiveWindSpeedKph] = useState(windSpeedKph);

  useEffect(() => setLiveFeltTempC(feltTempC), [feltTempC]);
  useEffect(() => setLiveWindSpeedKph(windSpeedKph), [windSpeedKph]);

  return (
    <View className="border-t border-rule pt-4 mt-4">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        className="flex-row items-center justify-between"
      >
        <View className="flex-row items-center">
          <Text className="text-sm font-sans-medium text-ink">Troubleshoot</Text>
          {isOverridden && (
            <View className="ml-2 rounded-full bg-accent px-2 py-0.5">
              <Text className="text-xs font-sans-medium text-paper">Active</Text>
            </View>
          )}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#6B6259" />
      </Pressable>

      {open && (
        <View className="mt-4">
          <Text className="text-xs font-sans text-ink-muted mb-5">
            Drag either slider to see how today&apos;s recommendations would change at a different
            feels-like temperature or wind speed — this doesn&apos;t change the actual forecast.
          </Text>

          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-xs font-sans text-ink-muted">Feels like</Text>
            <Text className="text-xs font-sans-medium text-ink-muted">{Math.round(liveFeltTempC)}°C</Text>
          </View>
          <Slider
            minimumValue={FELT_TEMP_MIN_C}
            maximumValue={FELT_TEMP_MAX_C}
            step={1}
            value={liveFeltTempC}
            onValueChange={setLiveFeltTempC}
            onSlidingComplete={onFeltTempChange}
            minimumTrackTintColor="#6B1F2A"
            accessibilityLabel="Feels-like temperature"
          />

          <View className="flex-row items-center justify-between mb-1 mt-4">
            <Text className="text-xs font-sans text-ink-muted">Wind</Text>
            <Text className="text-xs font-sans-medium text-ink-muted">{Math.round(liveWindSpeedKph)}kph</Text>
          </View>
          <Slider
            minimumValue={WIND_MIN_KPH}
            maximumValue={WIND_MAX_KPH}
            step={1}
            value={liveWindSpeedKph}
            onValueChange={setLiveWindSpeedKph}
            onSlidingComplete={onWindChange}
            minimumTrackTintColor="#6B1F2A"
            accessibilityLabel="Wind speed"
          />

          {isOverridden && (
            <Pressable onPress={onReset} accessibilityRole="button" className="mt-4 items-center">
              <Text className="text-xs font-sans-medium text-accent">Reset to today&apos;s forecast</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

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
  const outfits = useMemo(() => {
    if (!isReady) return { shown: [], hasAnyOutfit: false };
    if (!isOverridden && !workAppropriateOnly) return state.initialOutfits;
    return outfitsFor(state.todayCandidates, effectiveFeltTempC, effectiveWindSpeedKph, workAppropriateOnly);
  }, [isReady, isOverridden, workAppropriateOnly, state, effectiveFeltTempC, effectiveWindSpeedKph]);

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
