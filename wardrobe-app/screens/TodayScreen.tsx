import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { EmptyState } from '../components/EmptyState';
import { useDbQuery } from '../hooks/useDbQuery';
import { listItems, listRatedPairKeys } from '../services/items';

/**
 * Placeholder for the weather-driven outfit generator (Phase 5).
 *
 * It shows the two numbers the generator will actually depend on rather than
 * inventing an outfit card with nothing behind it: a closet with no rated pairs
 * is the state in which generation has least to work with, and this says so.
 */
export function TodayScreen() {
  const { data, error, loading } = useDbQuery(async (db) => {
    const items = await listItems(db);
    return { itemCount: items.length, ratedPairs: (await listRatedPairKeys(db)).size };
  }, []);

  if (error) return <EmptyState title={error} />;
  if (loading && !data) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
      <View className="bg-white rounded-2xl border border-slate-200 p-5">
        <Text className="text-xs uppercase tracking-wide text-slate-500">Wardrobe</Text>
        <Text className="text-3xl font-bold text-slate-900 mt-1">{data?.itemCount ?? 0}</Text>
        <Text className="text-sm text-slate-500">items</Text>

        <View className="h-px bg-slate-200 my-4" />

        <Text className="text-3xl font-bold text-slate-900">{data?.ratedPairs ?? 0}</Text>
        <Text className="text-sm text-slate-500">pairs rated</Text>
      </View>

      <View className="bg-white rounded-2xl border border-slate-200 p-5 mt-4">
        <Text className="text-base font-semibold text-slate-900">Outfit generator</Text>
        <Text className="text-sm text-slate-500 mt-2">
          Phase 5 adds the Open-Meteo forecast, the warmth and wind targets, and generated outfit
          cards here. Rating pairs on the Match tab is what it will draw on.
        </Text>
      </View>
    </ScrollView>
  );
}
