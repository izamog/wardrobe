import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomBar } from '../components/BottomBar';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { chunkIntoRows, ItemGridRow } from '../components/ItemGrid';
import { OutfitCollage } from '../components/OutfitCollage';
import { useDbQuery } from '../hooks/useDbQuery';
import { listItems, listItemsWornOn, replaceOutfitLog } from '../services/items';
import { withDb } from '../services/database';
import { useTodayData } from '../contexts/TodayDataContext';
import { ALL_CATEGORIES } from '../utils/categories';
import { isValidDateString } from '../utils/date';
import { formatLongDate } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';
import type { Category, ClothingItem } from '../types/wardrobe';

/**
 * The live preview of what's been picked so far, plus a running count — kept
 * at the top of the screen so toggling an item's tile below shows its effect
 * on the actual collage immediately, the same "arranged per the rules" result
 * the Calendar grid will go on to show for this day.
 */
function SelectionPreview({ items }: { items: readonly ClothingItem[] }) {
  if (items.length === 0) {
    return (
      <View className="bg-paper-2 rounded-sm p-6 items-center">
        <Text className="text-sm font-sans text-ink-muted text-center">
          Select the pieces you wore below to build the collage.
        </Text>
      </View>
    );
  }
  // Wider than the previous w-40 (160px): the collage's own item sizes are
  // percentages of this container, so a small fixed width made even a
  // correctly-proportioned item (see utils/outfitCollageLayout.ts) read as
  // tiny in absolute terms — the fix for "still looks small" here is a
  // bigger canvas, not a bigger fraction of it.
  return (
    <View className="w-64 self-center">
      <OutfitCollage items={items} />
    </View>
  );
}

/** The category filter row: an "All" chip plus one per category — identical layout to Closet's. */
function CategoryFilterBar({
  filter,
  onFilterChange,
}: {
  filter: Category | null;
  onFilterChange: (category: Category | null) => void;
}) {
  return (
    <View className="border-b border-rule bg-paper">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-3 py-3 items-center"
      >
        <Chip label="All" selected={filter === null} onPress={() => onFilterChange(null)} />
        {ALL_CATEGORIES.map((category) => (
          <Chip
            key={category}
            label={category}
            selected={filter === category}
            onPress={() => onFilterChange(category)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** The date heading, live collage preview and selected-count line at the top of the screen. */
function SelectionHeader({ date, items }: { date: string; items: readonly ClothingItem[] }) {
  return (
    <View className="p-4 pb-0">
      <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted mb-3">{formatLongDate(date)}</Text>
      <SelectionPreview items={items} />
      <Text className="text-xs font-sans-semibold text-ink-muted text-center mt-2">
        {items.length} {items.length === 1 ? 'piece' : 'pieces'} selected
      </Text>
    </View>
  );
}

/** The loading/error/grid states for the item picker — split out to keep LogOutfitScreen's own length down. */
function ItemPickerGrid({
  items,
  error,
  loading,
  selectedIds,
  onToggle,
}: {
  items: ClothingItem[] | null;
  error: string | null;
  loading: boolean;
  selectedIds: ReadonlySet<string>;
  onToggle: (item: ClothingItem) => void;
}) {
  if (error) return <EmptyState title={error} />;
  if (loading && items === null) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <FlatList
      data={chunkIntoRows(items ?? [])}
      keyExtractor={(row) => row[0]?.id ?? 'empty'}
      contentContainerClassName="pb-28 grow"
      ListEmptyComponent={<EmptyState title="No items yet" detail="Add items in the Closet tab first." />}
      renderItem={({ item: row }) => (
        <ItemGridRow
          items={row}
          selectable
          isSelected={(item) => selectedIds.has(item.id)}
          onItemPress={onToggle}
        />
      )}
    />
  );
}

/** The fixed bottom save bar. */
function SaveBar({ saving, disabled, onSave }: { saving: boolean; disabled: boolean; onSave: () => void }) {
  return (
    <BottomBar>
      <Pressable
        onPress={onSave}
        disabled={saving || disabled}
        accessibilityRole="button"
        className={`rounded-sm py-3.5 items-center ${saving || disabled ? 'bg-rule' : 'bg-ink'}`}
      >
        <Text className="text-paper font-sans-medium">{saving ? 'Saving…' : 'Save outfit'}</Text>
      </Pressable>
    </BottomBar>
  );
}

/**
 * All the state and data-loading for the screen, split out of the component
 * itself so LogOutfitScreen below stays a plain render of what this returns —
 * the same split screens/addItemHooks.ts uses for AddItemScreen.
 */
function useLogOutfitState(date: string) {
  const [filter, setFilter] = useState<Category | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: filteredItems, error, loading } = useDbQuery((db) => listItems(db, filter), [filter]);
  // Unfiltered, so the preview collage and item count stay correct even while
  // a category chip narrows the grid below to something else.
  const { data: allItems } = useDbQuery((db) => listItems(db, null), []);
  const { data: existingIds } = useDbQuery((db) => listItemsWornOn(db, date), [date]);
  const { reload: reloadToday } = useTodayData();

  // Pre-selects whatever was already logged for this day, so tapping an
  // already-logged calendar cell opens straight into "here's what's on
  // record" rather than a blank picker the user has to rebuild from scratch.
  // Only runs once existingIds first arrives — later refetches (e.g. the
  // screen regaining focus) must not stomp on a selection in progress.
  useEffect(() => {
    if (existingIds && !initialized) {
      setSelectedIds(new Set(existingIds));
      setInitialized(true);
    }
  }, [existingIds, initialized]);

  // At most one selected item per exact category — picking a second Top (or
  // Belt, or anything else) swaps out whichever one of that category was
  // already picked, rather than wearing two of the same category at once.
  const categoryById = useMemo(
    () => new Map((allItems ?? []).map((item) => [item.id, item.category])),
    [allItems],
  );

  const toggle = (item: ClothingItem) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
        return next;
      }
      for (const id of current) {
        if (categoryById.get(id) === item.category) next.delete(id);
      }
      next.add(item.id);
      return next;
    });
  };

  const selectedItems = useMemo(
    () => (allItems ?? []).filter((item) => selectedIds.has(item.id)),
    [allItems, selectedIds],
  );

  async function save(): Promise<void> {
    setSaving(true);
    try {
      // replaceOutfitLog, not logOutfitWorn: this screen only ever shows and
      // edits a single day's outfit, so saving must replace whatever was
      // already logged for `date`, not stack a second row on top of it (see
      // replaceOutfitLog's own doc comment).
      await withDb((db) => replaceOutfitLog(db, [...selectedIds], date));
      // wearCount feeds Today's recency ranking -- see TodayDataContext's
      // own doc comment for why nothing refreshes its cached candidate pool
      // on its own.
      reloadToday();
    } finally {
      setSaving(false);
    }
  }

  return { filter, setFilter, filteredItems, error, loading, selectedIds, toggle, selectedItems, saving, save };
}

export function LogOutfitScreen() {
  const { date } = useRoute<RouteProp<RootStackParamList, 'LogOutfit'>>().params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const dateIsValid = isValidDateString(date);

  // Hooks can't be called conditionally, so an invalid date still reaches
  // useLogOutfitState — but as '', which every query here treats as "no
  // rows match" (a harmless read) rather than a real date, and the write
  // path (save) is never reachable below since the picker UI itself is
  // replaced by the error state instead of being rendered.
  const state = useLogOutfitState(dateIsValid ? date : '');

  // Refuses to proceed on a bad date rather than silently substituting
  // today's date — a route param this malformed didn't come from this app's
  // own Calendar screen, so guessing what the caller meant isn't this
  // screen's call to make.
  useEffect(() => {
    if (!dateIsValid) navigation.goBack();
  }, [dateIsValid, navigation]);

  if (!dateIsValid) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <EmptyState title="That date isn't valid" />
      </View>
    );
  }

  async function saveAndClose() {
    try {
      await state.save();
      navigation.goBack();
    } catch (e) {
      console.error('Failed to log outfit:', e);
      Alert.alert('Could not save', 'That outfit was not logged.');
    }
  }

  return (
    <View className="flex-1 bg-paper">
      <SelectionHeader date={date} items={state.selectedItems} />
      <CategoryFilterBar filter={state.filter} onFilterChange={state.setFilter} />
      <ItemPickerGrid
        items={state.filteredItems}
        error={state.error}
        loading={state.loading}
        selectedIds={state.selectedIds}
        onToggle={state.toggle}
      />
      <SaveBar saving={state.saving} disabled={state.selectedItems.length === 0} onSave={() => void saveAndClose()} />
    </View>
  );
}
