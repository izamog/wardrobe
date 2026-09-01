import React, { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { useDbQuery } from '../hooks/useDbQuery';
import { listArchivedItems, restoreItem } from '../services/items';
import { withDb } from '../services/database';
import { useTodayData } from '../contexts/TodayDataContext';
import { ARCHIVE_RETENTION_DAYS } from '../services/itemActions';
import { daysSince } from '../utils/date';
import type { ClothingItem } from '../types/wardrobe';

/**
 * Bulk-deleted items, held here for ARCHIVE_RETENTION_DAYS before
 * services/itemActions.ts's purgeExpiredArchivedItems removes them for good.
 *
 * This screen is what gives that grace period a purpose: without a way to
 * see and restore what's here, a 30-day hold is indistinguishable from an
 * immediate delete except for when the bytes actually go.
 */

function daysLeft(item: ClothingItem, now: Date = new Date()): number {
  return Math.max(0, ARCHIVE_RETENTION_DAYS - daysSince(item.archivedAt, now));
}

function ArchiveRow({
  item,
  restoring,
  onRestore,
}: {
  item: ClothingItem;
  restoring: boolean;
  onRestore: () => void;
}) {
  const left = daysLeft(item);
  // No card chrome around the row (per design.md's box-in-box rule) — rows
  // are separated by a hairline rule, and the thumbnail is a borderless
  // paper-toned image, not a bordered card nested inside a bordered row.
  return (
    <View className="flex-row items-center border-b border-rule pb-3 mb-3">
      <View className="w-16 aspect-[3/4] overflow-hidden bg-paper">
        <StoredImage path={item.imagePath} hasBakedMargin={item.imageMarginBaked} placeholder="No photo" />
      </View>
      <View className="flex-1 ml-3">
        {/* Same brand-name role (and font) as ItemGridRow's label band. */}
        <Text className="text-sm font-brand tracking-wide text-ink" numberOfLines={1}>
          {item.brand === 'Unknown' ? item.category : item.brand}
        </Text>
        <Text className="text-xs font-sans text-ink-muted" numberOfLines={1}>
          {item.category}
        </Text>
        <Text className="text-xs font-sans text-ink-muted mt-1">
          {left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'Deleting soon'}
        </Text>
      </View>
      <Pressable
        onPress={onRestore}
        disabled={restoring}
        accessibilityRole="button"
        className={`rounded-sm px-4 py-3 ${restoring ? 'bg-rule' : 'bg-ink'}`}
      >
        <Text className={`text-sm font-sans-medium ${restoring ? 'text-ink-muted' : 'text-paper'}`}>
          {restoring ? 'Restoring…' : 'Restore'}
        </Text>
      </Pressable>
    </View>
  );
}

export function ArchiveScreen() {
  const { data: items, error, loading, reload } = useDbQuery((db) => listArchivedItems(db), []);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { invalidate: invalidateToday } = useTodayData();

  async function restore(item: ClothingItem) {
    setRestoringId(item.id);
    try {
      await withDb((db) => restoreItem(db, item.id));
      await reload();
      // A restored item is eligible for Today again -- see TodayDataContext's
      // own doc comment for why nothing refreshes its cached candidate pool
      // on its own.
      invalidateToday();
    } catch (e) {
      console.error('Failed to restore item:', e);
      Alert.alert('Could not restore', 'The item is still archived. Please try again.');
    } finally {
      setRestoringId(null);
    }
  }

  if (error) return <EmptyState title={error} />;
  if (loading && items === null) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-paper"
      data={items ?? []}
      keyExtractor={(item) => item.id}
      contentContainerClassName="p-4 grow"
      ListEmptyComponent={
        <EmptyState
          title="Nothing archived"
          detail={`Deleted items stay here for ${ARCHIVE_RETENTION_DAYS} days before they're removed for good.`}
        />
      }
      renderItem={({ item }) => (
        <ArchiveRow item={item} restoring={restoringId === item.id} onRestore={() => void restore(item)} />
      )}
    />
  );
}
