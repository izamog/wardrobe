import React from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { GRID_COLUMNS, ItemTile, type Badge } from '../components/ItemTile';
import { useDbQuery } from '../hooks/useDbQuery';
import {
  clearCompatibility,
  getItem,
  getVerdictsFor,
  listItemsInCategories,
  setCompatibility,
} from '../services/items';
import { withDb } from '../services/database';
import { getComplementaryCategories } from '../utils/categories';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem, CompatibilityStatus } from '../types/wardrobe';

/**
 * Tapping a tile walks unrated -> MATCH -> DISMATCH -> unrated.
 *
 * Three states need three stops, and returning to unrated matters: a mistap
 * would otherwise be permanent, and "unrated" is not the same as "DISMATCH" to
 * the Phase 5 generator, which only excludes explicit dismatches.
 */
function nextStatus(current: CompatibilityStatus | null): CompatibilityStatus | null {
  if (current === null) return 'MATCH';
  if (current === 'MATCH') return 'DISMATCH';
  return null;
}

const badgeFor = (status: CompatibilityStatus | null): Badge =>
  status === 'MATCH' ? 'match' : status === 'DISMATCH' ? 'dismatch' : 'unrated';

interface BrowserData {
  item: ClothingItem | null;
  candidates: ClothingItem[];
  verdicts: Map<string, CompatibilityStatus>;
}

export function MatchesBrowserScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { itemId } = useRoute<RouteProp<RootStackParamList, 'MatchesBrowser'>>().params;

  const { data, error, loading, reload } = useDbQuery<BrowserData>(async (db) => {
    const item = await getItem(db, itemId);
    if (!item) return { item: null, candidates: [], verdicts: new Map() };
    return {
      item,
      // Same-category items are never candidates — a top does not pair with
      // another top — which is exactly what getComplementaryCategories encodes.
      candidates: await listItemsInCategories(db, getComplementaryCategories(item.category)),
      verdicts: await getVerdictsFor(db, itemId),
    };
  }, [itemId]);

  React.useLayoutEffect(() => {
    if (data?.item) navigation.setOptions({ title: `Matches: ${data.item.brand}` });
  }, [navigation, data?.item]);

  if (error) return <EmptyState title={error} />;
  if (loading && !data) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator />
      </View>
    );
  }
  if (!data?.item) return <EmptyState title="This item no longer exists." />;

  async function toggle(candidateId: string) {
    const next = nextStatus(data?.verdicts.get(candidateId) ?? null);
    try {
      await withDb((db) =>
        next === null
          ? clearCompatibility(db, itemId, candidateId)
          : setCompatibility(db, itemId, candidateId, next),
      );
      await reload();
    } catch (e) {
      console.error('Failed to record verdict:', e);
    }
  }

  return (
    <View className="flex-1 bg-slate-50">
      <Text className="px-4 py-3 text-sm text-slate-500 bg-white border-b border-slate-200">
        Tap to cycle: unrated → match → dismatch.
      </Text>
      <FlatList
        data={data.candidates}
        keyExtractor={(candidate) => candidate.id}
        numColumns={GRID_COLUMNS}
        contentContainerClassName="p-2 grow"
        ListEmptyComponent={
          <EmptyState
            title="Nothing to match against yet"
            detail="Add items in other categories first."
          />
        }
        renderItem={({ item: candidate }) => (
          <ItemTile
            item={candidate}
            badge={badgeFor(data.verdicts.get(candidate.id) ?? null)}
            onPress={() => void toggle(candidate.id)}
          />
        )}
      />
    </View>
  );
}
