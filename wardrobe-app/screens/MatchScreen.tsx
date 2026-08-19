import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { useDbQuery } from '../hooks/useDbQuery';
import { listItems, listRatedPairKeys, setCompatibility } from '../services/items';
import { withDb } from '../services/database';
import { buildUnratedPairs, type ItemPair } from '../utils/pairs';
import type { ClothingItem, CompatibilityStatus } from '../types/wardrobe';

function PairFace({ item }: { item: ClothingItem }) {
  return (
    <View className="flex-1 mx-1.5">
      <View className="aspect-square rounded-2xl bg-slate-200 overflow-hidden items-center justify-center">
        <StoredImage path={item.imagePath} placeholder="No photo" />
      </View>
      <Text className="text-sm font-semibold text-slate-900 mt-2 text-center" numberOfLines={1}>
        {item.brand}
      </Text>
      <Text className="text-xs text-slate-500 text-center">{item.category}</Text>
    </View>
  );
}

export function MatchScreen() {
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

  if (!pair) {
    return (
      <View className="flex-1 bg-slate-50">
        <EmptyState
          title={deck.length === 0 ? 'No pairs to rate' : 'All caught up'}
          detail={
            deck.length === 0
              ? 'Add items in two different categories to start matching.'
              : 'Every pair in your closet has a verdict.'
          }
        />
        <View className="p-4">
          <Pressable
            onPress={() => {
              setCursor(0);
              void reload();
            }}
            accessibilityRole="button"
            className="rounded-xl py-3.5 items-center bg-slate-900"
          >
            <Text className="text-white font-semibold">Refresh</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 p-4">
      <Text className="text-center text-sm text-slate-500 mb-4">
        {deck.length - cursor} {deck.length - cursor === 1 ? 'pair' : 'pairs'} left
      </Text>

      <View className="flex-row items-center justify-center">
        <PairFace item={pair.a} />
        <PairFace item={pair.b} />
      </View>

      <View className="flex-row mt-8">
        <Pressable
          onPress={() => void rate('DISMATCH')}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Dismatch"
          className="flex-1 mr-2 rounded-2xl py-6 items-center bg-rose-600"
        >
          <Text className="text-white text-3xl font-bold">✕</Text>
        </Pressable>
        <Pressable
          onPress={() => void rate('MATCH')}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Match"
          className="flex-1 ml-2 rounded-2xl py-6 items-center bg-emerald-600"
        >
          <Text className="text-white text-3xl font-bold">✓</Text>
        </Pressable>
      </View>

      <View className="mt-auto">
        <Text className="text-center text-xs text-slate-400">
          Outfit photo auto-match arrives in Phase 4.
        </Text>
      </View>
    </View>
  );
}
