import React from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { ItemPhotoBackdrop } from '../components/ItemPhotoBackdrop';
import { StoredImage } from '../components/StoredImage';
import { chunkIntoRows, ItemGridRow, type Badge } from '../components/ItemGrid';
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
import { isCompatibleCandidate } from '../utils/pairs';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem, CompatibilityStatus } from '../types/wardrobe';

/**
 * Tapping a tile toggles DISMATCH on or off — an X appears, tapping again
 * clears it back to unrated. Previously a three-stop cycle (unrated -> MATCH
 * -> DISMATCH -> unrated); per direct feedback that rolling through a tick
 * before reaching the X made marking a dismatch two taps rather than one.
 * MATCH itself hasn't been removed as a status — OutfitMatchScreen's "match
 * from a photo" flow still writes it, and an item already MATCHed there
 * still shows that badge here — a tap on this screen just no longer stops
 * on it: any tap sets DISMATCH outright, from unrated or from an existing
 * MATCH alike.
 */
function nextStatus(current: CompatibilityStatus | null): CompatibilityStatus | null {
  return current === 'DISMATCH' ? null : 'DISMATCH';
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
    // Same-category items are never candidates — a top does not pair with
    // another top — which is exactly what getComplementaryCategories encodes.
    // isCompatibleCandidate narrows further: belt loops and hardware finish.
    const byCategory = await listItemsInCategories(db, getComplementaryCategories(item.category));
    return {
      item,
      candidates: byCategory.filter((candidate) => isCompatibleCandidate(item, candidate)),
      verdicts: await getVerdictsFor(db, itemId),
    };
  }, [itemId]);

  React.useLayoutEffect(() => {
    if (data?.item) navigation.setOptions({ title: `Matches: ${data.item.brand}` });
  }, [navigation, data?.item]);

  if (error) return <EmptyState title={error} />;
  if (loading && !data) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
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
    <View className="flex-1 bg-paper">
      {/* A small reminder of what's being dismatched against — the header's
          own title already names the item's brand, but a thumbnail is what
          actually lets you recognise it while scanning the grid below,
          without having to read back up to the title each time. */}
      <View className="flex-row items-center px-4 py-3 bg-paper border-b border-rule">
        <View className="w-11 h-11 rounded-sm overflow-hidden mr-3">
          <ItemPhotoBackdrop />
          <StoredImage
            path={data.item.imagePath}
            hasBakedMargin={data.item.imageMarginBaked}
            placeholder=""
          />
        </View>
        <Text className="flex-1 text-sm font-sans text-ink-muted">
          Tap an item to mark it a dismatch against {data.item.brand}. Tap again to remove it.
        </Text>
      </View>
      <FlatList
        data={chunkIntoRows(data.candidates)}
        keyExtractor={(row) => row[0]?.id ?? 'empty'}
        contentContainerClassName="grow"
        ListEmptyComponent={
          <EmptyState
            title="Nothing to match against yet"
            detail="Add items in other categories first."
          />
        }
        renderItem={({ item: row }) => (
          <ItemGridRow
            items={row}
            badgeFor={(candidate) => badgeFor(data.verdicts.get(candidate.id) ?? null)}
            onItemPress={(candidate) => void toggle(candidate.id)}
          />
        )}
      />
    </View>
  );
}
