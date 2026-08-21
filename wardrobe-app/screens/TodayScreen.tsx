import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { currentLocation } from '../services/location';
import { fetchTodayForecast, type DailyForecast } from '../services/weather';
import { generateClosestTodayOutfits } from '../services/outfitGenerator';
import { getLatestLoggedOutfit, logOutfitWorn } from '../services/items';
import { withDb } from '../services/database';
import { warmthCeiling, warmthFloor, windFloor } from '../utils/thermal';
import type { ScoredOutfit } from '../utils/outfitGenerator';
import { todayDateString } from '../utils/date';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem } from '../types/wardrobe';

/**
 * The weather-driven outfit generator (Phase 5).
 *
 * Location -> forecast -> thermal bounds -> generated outfits, in that
 * order, with each step's own honest failure state rather than a spinner
 * that never resolves. See services/location.ts, services/weather.ts,
 * utils/thermal.ts and services/outfitGenerator.ts for the pieces this
 * screen only assembles.
 */

type LoadState =
  | { step: 'loading' }
  | { step: 'location-denied' }
  | { step: 'weather-unavailable' }
  | {
      step: 'ready';
      today: string;
      forecast: DailyForecast;
      warmthFloor: number;
      warmthCeiling: number;
      windFloor: number;
      /**
       * Every outfit the search space could build, ranked closest to today's
       * bounds first — real matches sort first among themselves (distance 0),
       * so this is "the recommendation and its alternatives" when enough
       * exist, and "the closest the wardrobe could get" when they don't,
       * without needing two separate searches or two separate empty states.
       * See generateClosestTodayOutfits.
       */
      outfits: ScoredOutfit[];
      wornToday: ClothingItem[];
    };

async function loadToday(): Promise<LoadState> {
  const location = await currentLocation();
  if (!location.ok) {
    // 'unavailable' (no fix, GPS off) is folded into the same message as a
    // denied permission: either way there is nothing to retry without the
    // user doing something outside the app.
    return { step: 'location-denied' };
  }

  const today = todayDateString();
  const forecast = await fetchTodayForecast(location.coords, today);
  if (!forecast) return { step: 'weather-unavailable' };

  const bounds = {
    warmthFloor: warmthFloor(forecast.feltTempC),
    warmthCeiling: warmthCeiling(forecast.feltTempC),
    windFloor: windFloor(forecast.windSpeedKph, forecast.feltTempC),
  };
  const { outfits, wornToday } = await withDb(async (db) => {
    const [generated, worn] = await Promise.all([
      generateClosestTodayOutfits(db, { ...bounds, today }),
      getLatestLoggedOutfit(db, today),
    ]);
    return { outfits: generated, wornToday: worn };
  });

  return { step: 'ready', today, forecast, ...bounds, outfits, wornToday };
}

function LocationDeniedState() {
  return (
    <View className="flex-1 bg-slate-50">
      <EmptyState
        title="Location needed"
        detail="Wardrobe uses your location to fetch today's forecast. You can turn it on in Settings."
      />
      <View className="p-4">
        <Pressable
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          className="rounded-xl py-3.5 items-center bg-slate-900"
        >
          <Text className="text-white font-semibold">Open Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RetryState({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <View className="flex-1 bg-slate-50">
      <EmptyState title={title} detail={detail} />
      <View className="p-4">
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="rounded-xl py-3.5 items-center bg-slate-900"
        >
          <Text className="text-white font-semibold">Retry</Text>
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
    <View className="bg-white rounded-2xl border border-slate-200 p-5">
      <Text className="text-xs uppercase tracking-wide text-slate-500">Today</Text>
      <Text className="text-3xl font-bold text-slate-900 mt-1">
        {Math.round(forecast.tempC)}°C
      </Text>
      <Text className="text-sm text-slate-500">
        Feels like {Math.round(forecast.feltTempC)}°C · {Math.round(forecast.windSpeedKph)}kph wind
      </Text>
      <View className="h-px bg-slate-200 my-4" />
      <Text className="text-sm text-slate-500">
        Warmth needs to land between {warmthFloor} and {warmthCeiling} · Wind needs at least{' '}
        {windFloor}
      </Text>
      {/* Not "out of 10" here on purpose: these are bounds on an outfit's
          summed, weighted total (utils/thermal.ts), which routinely runs
          past 10 once more than one garment counts toward it — they aren't
          on the same 0-10 scale a single item's own score is. */}
      <Text className="text-xs text-slate-500 mt-1">
        Both are outfit totals, not a 0-10 score — a warmth floor of 0 means no extra layer is
        needed today, and the ceiling is what stops warm enough from becoming too warm.
      </Text>
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
    <Pressable onPress={onPress} accessibilityRole="button" className="w-16 mr-2">
      <View className="aspect-[3/4] rounded-lg overflow-hidden bg-white border border-slate-200">
        <StoredImage path={item.imagePath} placeholder="No photo" />
      </View>
      <Text className="text-xs text-slate-500 mt-1" numberOfLines={1}>
        {item.category}
      </Text>
      {showScores && (
        <Text className="text-xs text-slate-500" numberOfLines={1}>
          W{item.inferredWarmth} · Wd{item.inferredWind}
        </Text>
      )}
    </Pressable>
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
    <View className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4 mb-4">
      <Text className="text-xs uppercase tracking-wide text-emerald-700">Wearing today · {today}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
        {outfit.map((item) => (
          <OutfitThumbnail key={item.id} item={item} onPress={() => onItemPress(item.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * rank 0 is the generator's own top pick — generateClosestTodayOutfits sorts
 * real matches to the front by construction (distance 0 first, ties broken by
 * the same lean-first search order generateOutfits itself uses), so
 * outfits[0] genuinely is "what the algorithm recommends" whenever a real
 * match exists, not an arbitrary first entry.
 *
 * meetsTarget separately controls the badge and border: a card can be rank 0
 * and still not meet the target, when nothing in the wardrobe does — that's
 * "the closest attempt", not a recommendation, and the styling says so rather
 * than implying a match that isn't there. Wearing it is still offered either
 * way; it's a real closet combination and the choice is the user's.
 */
function OutfitCard({
  outfit,
  rank,
  warmthFloor,
  warmthCeiling,
  windFloor,
  wearing,
  onWear,
  onItemPress,
}: {
  outfit: ScoredOutfit;
  rank: number;
  warmthFloor: number;
  warmthCeiling: number;
  windFloor: number;
  wearing: boolean;
  onWear: () => void;
  onItemPress: (itemId: string) => void;
}) {
  const { meetsTarget } = outfit;
  const isTopMatch = meetsTarget && rank === 0;
  const label = meetsTarget
    ? rank === 0
      ? 'Best match'
      : `Runner-up ${rank}`
    : rank === 0
      ? 'Closest available (short of target)'
      : `Runner-up ${rank} (short of target)`;
  return (
    <View
      className={`bg-white rounded-2xl border p-4 mb-3 ${meetsTarget ? 'border-emerald-400 border-2' : 'border-slate-200'}`}
    >
      <View className="flex-row items-center mb-2">
        {isTopMatch && <Ionicons name="star" size={12} color="#059669" style={{ marginRight: 4 }} />}
        <Text
          className={`text-xs font-semibold uppercase tracking-wide ${meetsTarget ? 'text-emerald-600' : 'text-slate-500'}`}
        >
          {label}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {outfit.items.map((item) => (
          <OutfitThumbnail key={item.id} item={item} onPress={() => onItemPress(item.id)} showScores />
        ))}
      </ScrollView>
      {/* An outfit's total is a body-region-weighted sum, so it can land on a
          fraction — rounded here for display only, the real comparison
          against the bounds uses the exact value. */}
      <Text className="text-xs text-slate-500 mt-2">
        Warmth {Math.round(outfit.warmth)} (needs {warmthFloor}-{warmthCeiling}) · Wind{' '}
        {Math.round(outfit.wind)} (needs {windFloor}+)
      </Text>
      <Pressable
        onPress={onWear}
        disabled={wearing}
        accessibilityRole="button"
        className={`rounded-xl py-3 items-center mt-3 ${wearing ? 'bg-slate-300' : 'bg-emerald-600'}`}
      >
        <Text className="text-white font-semibold">{wearing ? 'Saving…' : 'Wear this outfit'}</Text>
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

export function TodayScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [state, setState] = useState<LoadState>({ step: 'loading' });
  const [wearingIndex, setWearingIndex] = useState<number | null>(null);

  const reload = useCallback(() => {
    setState({ step: 'loading' });
    void loadToday().then(setState);
  }, []);

  useFocusEffect(reload);

  const openItem = useCallback(
    (itemId: string) => navigation.navigate('ItemDetails', { itemId }),
    [navigation],
  );

  async function wearOutfit(outfit: readonly ClothingItem[], index: number) {
    setWearingIndex(index);
    try {
      await withDb((db) => logOutfitWorn(db, outfit.map((item) => item.id), todayDateString()));
      reload();
    } catch (e) {
      console.error('Failed to log outfit as worn:', e);
      Alert.alert('Could not save', 'That outfit was not logged as worn.');
    } finally {
      setWearingIndex(null);
    }
  }

  if (state.step === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
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

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
      {state.wornToday.length > 0 && (
        <TodayOutfitBanner today={state.today} outfit={state.wornToday} onItemPress={openItem} />
      )}

      <ForecastSummary
        forecast={state.forecast}
        warmthFloor={state.warmthFloor}
        warmthCeiling={state.warmthCeiling}
        windFloor={state.windFloor}
      />

      <View className="mt-4">
        {state.outfits.length === 0 ? (
          <NoOutfitState />
        ) : (
          state.outfits.map((outfit, index) => (
            <OutfitCard
              key={outfit.items.map((item) => item.id).join('|')}
              outfit={outfit}
              rank={index}
              warmthFloor={state.warmthFloor}
              warmthCeiling={state.warmthCeiling}
              windFloor={state.windFloor}
              wearing={wearingIndex === index}
              onWear={() => void wearOutfit(outfit.items, index)}
              onItemPress={openItem}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}
