import React, { useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomBar } from '../components/BottomBar';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { chunkIntoRows, ItemGridRow } from '../components/ItemGrid';
import { useDbQuery } from '../hooks/useDbQuery';
import { archiveItems, listItems, setItemFlags } from '../services/items';
import { withDb } from '../services/database';
import { ALL_CATEGORIES } from '../utils/categories';
import { CLOSET_SORT_LABELS, sortItems, type ClosetSort } from '../utils/closetSort';
import { useTodayData } from '../contexts/TodayDataContext';
import type { RootStackParamList } from '../navigation/types';
import type { Category, ClothingItem } from '../types/wardrobe';

/** Every sort option, in the order the action sheet lists them. */
const CLOSET_SORTS: readonly ClosetSort[] = ['newest', 'price', 'dateBought', 'brand', 'colour'];

/** The native action sheet Sort opens — one Alert, no custom menu component. */
function presentSortOptions(current: ClosetSort, onChange: (sort: ClosetSort) => void) {
  Alert.alert(
    'Sort by',
    undefined,
    [
      ...CLOSET_SORTS.map((sort) => ({
        text: sort === current ? `${CLOSET_SORT_LABELS[sort]} ✓` : CLOSET_SORT_LABELS[sort],
        onPress: () => onChange(sort),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ],
  );
}

type ClosetNav = NativeStackNavigationProp<RootStackParamList>;

/** One bulk action button in SelectionBar — Delete's own destructive styling stays inline there, this is for the neutral "mark as" pair. */
function SelectionAction({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      className={`flex-1 rounded-sm px-2 py-3 items-center border ${disabled || busy ? 'border-rule' : 'border-ink'}`}
    >
      <Text className={`text-xs font-sans-medium text-center ${disabled || busy ? 'text-ink-muted' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The bar under the header while bulk-select mode is active: a count, then
 * every bulk action selection exists for.
 *
 * A separate bar rather than reusing the FAB's corner: the FAB navigates to
 * Add Item, which has no meaning while a selection is in progress, so it's
 * hidden for the same reason this bar appears — the screen is doing a
 * different job right now.
 *
 * "Mark second-hand" / "Mark work appropriate" set the flag true for the
 * whole selection in one call (setItemFlags) — there's no bulk "unset" here,
 * matching what was actually asked for; toggling one back off is still a
 * per-item edit on ItemDetailsScreen.
 */
function SelectionBar({
  count,
  archiving,
  marking,
  onArchive,
  onMarkSecondHand,
  onMarkWorkAppropriate,
}: {
  count: number;
  archiving: boolean;
  marking: boolean;
  onArchive: () => void;
  onMarkSecondHand: () => void;
  onMarkWorkAppropriate: () => void;
}) {
  const disabled = count === 0;
  return (
    <BottomBar>
      <Text className="text-sm font-sans-semibold text-ink-muted mb-2">
        {count} {count === 1 ? 'item' : 'items'} selected
      </Text>
      <View className="flex-row gap-2">
        <SelectionAction
          label="Second-hand"
          busy={marking}
          disabled={disabled}
          onPress={onMarkSecondHand}
        />
        <SelectionAction
          label="Work appropriate"
          busy={marking}
          disabled={disabled}
          onPress={onMarkWorkAppropriate}
        />
        <Pressable
          onPress={onArchive}
          disabled={disabled || archiving}
          accessibilityRole="button"
          className={`flex-1 rounded-sm px-2 py-3 items-center ${disabled || archiving ? 'bg-rule' : 'bg-rose-600'}`}
        >
          <Text
            className={`text-xs font-sans-medium text-center ${disabled || archiving ? 'text-ink-muted' : 'text-white'}`}
          >
            {archiving ? 'Deleting…' : 'Delete'}
          </Text>
        </Pressable>
      </View>
    </BottomBar>
  );
}

/**
 * The header's left-hand buttons: match-from-a-photo and Archive, both
 * hidden while selecting.
 *
 * Match-from-a-photo used to only be reachable from the Match tab's own
 * empty-deck/rating screens; now that that tab is gone (matches live per
 * item, via ItemDetailsScreen's "Matches" button -> MatchesBrowserScreen)
 * this is its only entry point.
 *
 * Kept on the left, separate from Select/Cancel on the right (see
 * ClosetHeaderRight below): a tab root screen has no back button to share
 * headerLeft with, and three controls previously crowded together on one
 * side left Select sitting hard against the screen edge with only its own
 * hitSlop between it and the corner.
 *
 * The leading (camera) icon carries `pl-3` rather than the trailing icons'
 * `px-2` — matching the Add FAB's `right-6` (24px) edge margin, not just the
 * default the header slot itself provides, since that default was what
 * "too close to the side of the screen" was reported against.
 */
function ClosetHeaderLeft({ navigation, selecting }: { navigation: ClosetNav; selecting: boolean }) {
  if (selecting) return null;
  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={() => navigation.navigate('OutfitMatch')}
        accessibilityRole="button"
        accessibilityLabel="Match from a photo"
        hitSlop={12}
        className="pl-3 pr-2 py-1"
      >
        <Ionicons name="camera-outline" size={22} color="#1A1714" />
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Archive')}
        accessibilityRole="button"
        accessibilityLabel="Archive"
        hitSlop={12}
        className="px-2 py-1"
      >
        <Ionicons name="archive-outline" size={22} color="#1A1714" />
      </Pressable>
    </View>
  );
}

/**
 * The header's right-hand controls: Sort, then Select/Cancel.
 *
 * Select's trailing padding is `pr-3`, not the previous `pr-1` — see
 * ClosetHeaderLeft's own comment; the same "too close to the screen edge"
 * report named this button specifically.
 */
function ClosetHeaderRight({
  selecting,
  onToggleSelecting,
  sort,
  onSortPress,
}: {
  selecting: boolean;
  onToggleSelecting: () => void;
  sort: ClosetSort;
  onSortPress: () => void;
}) {
  return (
    <View className="flex-row items-center">
      {!selecting && (
        <Pressable
          onPress={onSortPress}
          accessibilityRole="button"
          accessibilityLabel={`Sort by (currently ${CLOSET_SORT_LABELS[sort]})`}
          hitSlop={12}
          className="pl-2 pr-2 py-1"
        >
          <Ionicons name="swap-vertical-outline" size={22} color="#1A1714" />
        </Pressable>
      )}
      <Pressable
        onPress={onToggleSelecting}
        accessibilityRole="button"
        hitSlop={12}
        className="pl-2 pr-3 py-1"
      >
        <Text className="text-base font-sans-medium text-ink">{selecting ? 'Cancel' : 'Select'}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The category filter row: an "All" chip plus one per category.
 *
 * `pt-4` (up from `py-3`'s symmetric 12px) rather than a matching bump to
 * the bottom: the report was the row sitting too high up against the header,
 * not that the row felt cramped from below.
 */
function CategoryFilterBar({
  filter,
  onFilterChange,
}: {
  filter: Category | null;
  onFilterChange: (category: Category | null) => void;
}) {
  return (
    <View className="border-b border-rule bg-paper">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-3 pt-4 pb-3">
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

/**
 * Confirms and runs the bulk delete-to-archive, in one place so ClosetScreen
 * only has to call it.
 */
function confirmAndArchive(
  ids: readonly string[],
  { setArchiving, onDone }: { setArchiving: (v: boolean) => void; onDone: () => Promise<void> },
) {
  const count = ids.length;
  Alert.alert(
    count === 1 ? 'Delete this item?' : `Delete ${count} items?`,
    'Deleted items are held for 30 days before being removed for good — you can restore them from Archive until then.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setArchiving(true);
            try {
              await withDb((db) => archiveItems(db, ids));
              await onDone();
            } catch (e) {
              console.error('Failed to archive items:', e);
              Alert.alert('Could not delete', 'Those items are still in your closet.');
            } finally {
              setArchiving(false);
            }
          })();
        },
      },
    ],
  );
}

/** Runs a bulk mark-as-flag and reports a failure the same way confirmAndArchive does. Non-destructive and reversible per item, so unlike Delete this doesn't confirm first. */
async function markSelected(
  ids: readonly string[],
  flags: { isSecondHand?: boolean; isWorkAppropriate?: boolean },
  { setMarking, onDone }: { setMarking: (v: boolean) => void; onDone: () => Promise<void> },
): Promise<void> {
  setMarking(true);
  try {
    await withDb((db) => setItemFlags(db, ids, flags));
    await onDone();
  } catch (e) {
    console.error('Failed to mark items:', e);
    Alert.alert('Could not update', 'Those items were not changed.');
  } finally {
    setMarking(false);
  }
}

interface ClosetGridProps {
  items: ClothingItem[] | null;
  error: string | null;
  loading: boolean;
  filter: Category | null;
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  onItemPress: (id: string) => void;
  onItemLongPress: (id: string) => void;
}

function emptyDetail(filter: Category | null): string {
  return filter ? `Nothing in ${filter}. Tap + to add something.` : 'Tap + to add your first item.';
}

/** The loading/error/empty/grid states for the closet's item list. */
function ClosetGrid({
  items,
  error,
  loading,
  filter,
  selecting,
  selectedIds,
  onItemPress,
  onItemLongPress,
}: ClosetGridProps) {
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
      contentContainerClassName={selecting ? 'pb-24 grow' : 'pb-28 grow'}
      ListEmptyComponent={<EmptyState title="No items yet" detail={emptyDetail(filter)} />}
      renderItem={({ item: row }) => (
        <ItemGridRow
          items={row}
          selectable={selecting}
          isSelected={(item) => selectedIds.has(item.id)}
          onItemPress={(item) => onItemPress(item.id)}
          onItemLongPress={(item) => onItemLongPress(item.id)}
          showCategory={false}
        />
      )}
    />
  );
}

/** Bulk-select state and the two mutations every caller needs — pulled out so ClosetScreen stays short. */
function useSelection() {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const exit = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const toggle = (id: string) => {
    setSelecting((current) => current || true);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return { selecting, setSelecting, selectedIds, exit, toggle };
}

/** The bottom bar: the selection bar while selecting, otherwise the Add FAB. */
function ClosetFooter({
  selecting,
  selectedIds,
  archiving,
  setArchiving,
  marking,
  setMarking,
  exitSelection,
  reload,
  onAddPress,
}: {
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  archiving: boolean;
  setArchiving: (v: boolean) => void;
  marking: boolean;
  setMarking: (v: boolean) => void;
  exitSelection: () => void;
  reload: () => Promise<void>;
  onAddPress: () => void;
}) {
  if (selecting) {
    return (
      <SelectionBar
        count={selectedIds.size}
        archiving={archiving}
        marking={marking}
        onArchive={() =>
          confirmAndArchive([...selectedIds], {
            setArchiving,
            onDone: async () => {
              exitSelection();
              await reload();
            },
          })
        }
        onMarkSecondHand={() =>
          void markSelected([...selectedIds], { isSecondHand: true }, { setMarking, onDone: reload })
        }
        onMarkWorkAppropriate={() =>
          void markSelected([...selectedIds], { isWorkAppropriate: true }, { setMarking, onDone: reload })
        }
      />
    );
  }
  return (
    <Pressable
      onPress={onAddPress}
      accessibilityRole="button"
      accessibilityLabel="Add item"
      className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-ink items-center justify-center shadow-lg"
    >
      <Text className="text-white text-3xl leading-9 font-sans-medium">+</Text>
    </Pressable>
  );
}

export function ClosetScreen() {
  const navigation = useNavigation<ClosetNav>();
  // null is the "All" chip rather than a missing value; listItems reads it the
  // same way.
  const [filter, setFilter] = useState<Category | null>(null);
  const [sort, setSort] = useState<ClosetSort>('newest');
  const { selecting, setSelecting, selectedIds, exit: exitSelection, toggle: toggleSelected } =
    useSelection();
  const [archiving, setArchiving] = useState(false);
  const [marking, setMarking] = useState(false);

  const { data: items, error, loading, reload } = useDbQuery((db) => listItems(db, filter), [filter]);
  const sortedItems = useMemo(() => (items ? sortItems(items, sort) : items), [items, sort]);
  const { reload: reloadToday } = useTodayData();
  // Delete and the two bulk-mark actions all change whether/how the
  // selected items show up in Today -- see TodayDataContext's own doc
  // comment for why nothing refreshes its cached candidate pool on its own.
  // ClosetFooter only needs one reload to call, so this composes both here
  // rather than widening its props.
  const reloadClosetAndToday = async () => {
    await reload();
    reloadToday();
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <ClosetHeaderLeft navigation={navigation} selecting={selecting} />,
      headerRight: () => (
        <ClosetHeaderRight
          selecting={selecting}
          onToggleSelecting={() => (selecting ? exitSelection() : setSelecting(true))}
          sort={sort}
          onSortPress={() => presentSortOptions(sort, setSort)}
        />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, selecting, sort]);

  return (
    <View className="flex-1 bg-paper">
      <CategoryFilterBar filter={filter} onFilterChange={setFilter} />

      <ClosetGrid
        items={sortedItems}
        error={error}
        loading={loading}
        filter={filter}
        selecting={selecting}
        selectedIds={selectedIds}
        onItemPress={(id) =>
          selecting ? toggleSelected(id) : navigation.navigate('ItemDetails', { itemId: id })
        }
        onItemLongPress={toggleSelected}
      />

      <ClosetFooter
        selecting={selecting}
        selectedIds={selectedIds}
        archiving={archiving}
        setArchiving={setArchiving}
        marking={marking}
        setMarking={setMarking}
        exitSelection={exitSelection}
        reload={reloadClosetAndToday}
        onAddPress={() => navigation.navigate('AddItem', filter ? { category: filter } : undefined)}
      />
    </View>
  );
}
