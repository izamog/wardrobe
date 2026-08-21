import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { useDbQuery } from '../hooks/useDbQuery';
import { listItems, listRatedPairKeys, setCompatibility } from '../services/items';
import { withDb } from '../services/database';
import { buildUnratedPairs, type ItemPair } from '../utils/pairs';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem, CompatibilityStatus } from '../types/wardrobe';

function PairFace({ item }: { item: ClothingItem }) {
  return (
    <View className="flex-1 mx-1.5">
      <View className="aspect-[3/4] rounded-2xl bg-white border border-slate-200 overflow-hidden items-center justify-center">
        <StoredImage path={item.imagePath} placeholder="No photo" />
      </View>
      <Text className="text-sm font-semibold text-slate-900 mt-2 text-center" numberOfLines={1}>
        {item.brand}
      </Text>
      <Text className="text-xs text-slate-500 text-center">{item.category}</Text>
    </View>
  );
}

/** A text link to the outfit-photo flow, shared between the deck and the empty state. */
function OutfitPhotoLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="py-2 items-center">
      <Text className="text-center text-xs text-slate-500 underline">
        Or match from an outfit photo
      </Text>
    </Pressable>
  );
}

/** Shown when there is no pair left to rate — either the deck is empty or every pair has a verdict. */
function EmptyDeck({
  isEmpty,
  onRefresh,
  onOutfitPhoto,
}: {
  isEmpty: boolean;
  onRefresh: () => void;
  onOutfitPhoto: () => void;
}) {
  return (
    <View className="flex-1 bg-slate-50">
      <EmptyState
        title={isEmpty ? 'No pairs to rate' : 'All caught up'}
        detail={
          isEmpty
            ? 'Add items in two different categories to start matching.'
            : 'Every pair in your closet has a verdict.'
        }
      />
      <View className="p-4">
        <Pressable
          onPress={onRefresh}
          accessibilityRole="button"
          className="rounded-xl py-3.5 items-center bg-slate-900"
        >
          <Text className="text-white font-semibold">Refresh</Text>
        </Pressable>
        <OutfitPhotoLink onPress={onOutfitPhoto} />
      </View>
    </View>
  );
}

/** The pair on screen plus the Dismatch/Match buttons. */
function RatingView({
  pair,
  remaining,
  saving,
  onRate,
  onOutfitPhoto,
}: {
  pair: ItemPair;
  remaining: number;
  saving: boolean;
  onRate: (status: CompatibilityStatus) => void;
  onOutfitPhoto: () => void;
}) {
  return (
    <View className="flex-1 bg-slate-50 p-4">
      <Text className="text-center text-sm text-slate-500 mb-4">
        {remaining} {remaining === 1 ? 'pair' : 'pairs'} left
      </Text>

      <View className="flex-row items-center justify-center">
        <PairFace item={pair.a} />
        <PairFace item={pair.b} />
      </View>

      <View className="flex-row mt-8">
        <Pressable
          onPress={() => onRate('DISMATCH')}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Dismatch"
          className="flex-1 mr-2 rounded-2xl py-6 items-center bg-rose-600"
        >
          <Ionicons name="close" size={32} color="#ffffff" />
        </Pressable>
        <Pressable
          onPress={() => onRate('MATCH')}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Match"
          className="flex-1 ml-2 rounded-2xl py-6 items-center bg-emerald-600"
        >
          <Ionicons name="checkmark" size={32} color="#ffffff" />
        </Pressable>
      </View>

      <View className="mt-auto">
        <OutfitPhotoLink onPress={onOutfitPhoto} />
      </View>
    </View>
  );
}

export function MatchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, error, loading, reload } = useDbQuery(async (db) => {
    const items = await listItems(db);
    return buildUnratedPairs(items, await listRatedPairKeys(db));
  }, []);

  // Index rather than a mutated copy of the deck: the deck is reloaded from the
  // database on focus, and an index survives that cleanly.
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);

  // The deck is rebuilt whenever the tab regains focus, so a cursor left over
  // from the previous deck would point at the wrong pair — or past the end.
  useEffect(() => {
    setCursor(0);
  }, [data]);

  const deck: ItemPair[] = data ?? [];
  const pair = deck[cursor];

  async function rate(status: CompatibilityStatus) {
    if (!pair || saving) return;
    setSaving(true);
    try {
      await withDb((db) => setCompatibility(db, pair.a.id, pair.b.id, status));
      setCursor((c) => c + 1);
    } catch (e) {
      console.error('Failed to record verdict:', e);
      Alert.alert('Could not save', 'That verdict was not recorded.');
    } finally {
      setSaving(false);
    }
  }

  if (error) return <EmptyState title={error} />;
  if (loading && !data) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator />
      </View>
    );
  }

  const goToOutfitPhoto = () => navigation.navigate('OutfitMatch');

  if (!pair) {
    return (
      <EmptyDeck
        isEmpty={deck.length === 0}
        onRefresh={() => {
          setCursor(0);
          void reload();
        }}
        onOutfitPhoto={goToOutfitPhoto}
      />
    );
  }

  return (
    <RatingView
      pair={pair}
      remaining={deck.length - cursor}
      saving={saving}
      onRate={(status) => void rate(status)}
      onOutfitPhoto={goToOutfitPhoto}
    />
  );
}
