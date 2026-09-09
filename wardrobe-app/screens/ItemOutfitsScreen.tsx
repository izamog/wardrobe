import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { CollageWithThumbnails } from './TodayScreen';
import { useDbQuery } from '../hooks/useDbQuery';
import { getItem } from '../services/items';
import { generateOutfitsWithItem } from '../services/outfitGenerator';
import { useTodayData } from '../contexts/TodayDataContext';
import { warmthCeiling, warmthFloor, windFloor } from '../utils/thermal';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem } from '../types/wardrobe';

/** How many outfits the button on ItemDetailsScreen promises. */
const ITEM_OUTFIT_COUNT = 4;

interface ItemOutfits {
  item: ClothingItem | null;
  outfits: ClothingItem[][];
}

/**
 * "Create outfit with item" — up to four weather-appropriate outfits, each
 * genuinely featuring the item ItemDetailsScreen was opened for. See
 * generateOutfitsWithItem's own doc comment for how "genuinely featuring"
 * is enforced.
 *
 * Weather bounds come from TodayDataContext, the same felt-temperature and
 * wind figures the Today tab itself recommends against — per the answered
 * "should this use today's forecast" question, not a separate weather
 * fetch or a user-facing temperature control of its own.
 */
export function ItemOutfitsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { itemId } = useRoute<RouteProp<RootStackParamList, 'ItemOutfits'>>().params;
  const { state } = useTodayData();

  const today = state.step === 'ready' ? state.today : null;
  const feltTempC = state.step === 'ready' ? state.forecast.feltTempC : null;
  const windSpeedKph = state.step === 'ready' ? state.forecast.windSpeedKph : null;

  const { data, error, loading } = useDbQuery<ItemOutfits>(
    async (db) => {
      const item = await getItem(db, itemId);
      if (!item || today === null || feltTempC === null || windSpeedKph === null) {
        return { item, outfits: [] };
      }
      const outfits = await generateOutfitsWithItem(
        db,
        item,
        {
          warmthFloor: warmthFloor(feltTempC),
          warmthCeiling: warmthCeiling(feltTempC),
          windFloor: windFloor(windSpeedKph, feltTempC),
          today,
        },
        ITEM_OUTFIT_COUNT,
      );
      return { item, outfits };
    },
    [itemId, today, feltTempC, windSpeedKph],
  );

  const openItem = (id: string) => navigation.navigate('ItemDetails', { itemId: id });

  if (error) return <EmptyState title={error} />;

  // Today's own weather load, not this screen's own query. While it's still
  // in flight, `today`/`feltTempC`/`windSpeedKph` above are all null, so the
  // query below resolves immediately with an empty outfit list -- without
  // this check first, that reads as "searched and found nothing" rather
  // than "hasn't searched yet", which is a real, misleading difference: the
  // former says stop waiting, the latter says the result just isn't in.
  if (state.step === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }

  // The other non-ready weather states (denied location, forecast
  // unavailable) already have their own dedicated messaging on the Today
  // tab; a generic one here is enough to explain why nothing can be built
  // yet without duplicating that copy.
  if (state.step === 'location-denied' || state.step === 'weather-unavailable' || state.step === 'error') {
    return (
      <EmptyState
        title="Today's forecast isn't available"
        detail="Open the Today tab to resolve this, then come back."
      />
    );
  }

  if (loading && !data) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }

  if (!data?.item) return <EmptyState title="This item no longer exists." />;

  if (data.outfits.length === 0) {
    return (
      <EmptyState
        title="No weather-appropriate outfit found"
        detail={`Nothing in your closet pairs with this ${data.item.category.toLowerCase()} for today's weather.`}
      />
    );
  }

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="p-4">
      {data.outfits.map((outfit, index) => (
        <View key={outfit.map((i) => i.id).join(',')} className={index > 0 ? 'mt-6 pt-6 border-t border-rule' : ''}>
          <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted mb-3">
            Option {index + 1}
          </Text>
          <CollageWithThumbnails items={outfit} onItemPress={openItem} />
        </View>
      ))}
    </ScrollView>
  );
}
