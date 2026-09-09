import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
  type ViewToken,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomBar } from '../components/BottomBar';
import { OutfitCollage } from '../components/OutfitCollage';
import { useDbQuery } from '../hooks/useDbQuery';
import { listLoggedOutfitsInRange, removeOutfitLogs } from '../services/items';
import { withDb } from '../services/database';
import { useTodayData } from '../contexts/TodayDataContext';
import {
  CALENDAR_GRID_COLUMNS,
  monthGrid,
  monthKeyForDate,
  monthLabelForKey,
  monthsAround,
  type MonthDay,
} from '../utils/calendarGrid';
import { todayDateString } from '../utils/date';
import { formatLongDate } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem } from '../types/wardrobe';

/** How far back/forward the horizontally-paged list reaches from the month containing today. */
const MONTHS_BEFORE = 60;
const MONTHS_AFTER = 60;

// Hoisted rather than created inline in the component: FlatList requires
// viewabilityConfig to keep the same identity across renders, or it throws.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 };

/** Stable "no outfit logged" result -- a fresh `[]` on every read would break useSyncExternalStore's snapshot-equality check below. */
const EMPTY_ITEMS: readonly ClothingItem[] = [];

/**
 * A tiny external store for the outfits-by-date cache CalendarScreen builds
 * up as MonthPages mount/refetch (see CalendarScreen's own comment on
 * `outfitsCache` for why this exists at all). Reading mutable data like this
 * during render is exactly what `useSyncExternalStore` is for -- it's React's
 * own mechanism for doing so safely under concurrent rendering, where a
 * plain `ref.current` read in a render path can, in principle, observe a
 * value that's about to change before React commits (this file previously
 * used a `useRef` Map plus a `cacheVersion` state counter as a hand-rolled
 * "wait for changes to be visible" signal; `useSyncExternalStore` replaces
 * both with the React-blessed version of the same idea).
 */
type OutfitsCache = {
  get(date: string): readonly ClothingItem[];
  setMany(entries: ReadonlyMap<string, ClothingItem[]>): void;
  setOne(date: string, items: ClothingItem[]): void;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
};

function createOutfitsCache(): OutfitsCache {
  const byDate = new Map<string, ClothingItem[]>();
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  return {
    get: (date) => byDate.get(date) ?? EMPTY_ITEMS,
    setMany: (entries) => {
      for (const [date, items] of entries) byDate.set(date, items);
      notify();
    },
    setOne: (date, items) => {
      byDate.set(date, items);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
  };
}

/** The first and last calendar date (inclusive) of a "YYYY-MM" month key. */
function monthDateRange(monthKey: string): [string, string] {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this one
  return [`${monthKey}-01`, `${monthKey}-${String(lastDay).padStart(2, '0')}`];
}

/**
 * One grid cell: the day-of-month number, and (only for a day that actually
 * falls in the page's own month) the day's collage if anything was logged.
 * A leading/trailing day borrowed from the adjacent month just to fill out
 * the 6-row grid is shown dimmed and inert instead — no collage query ran
 * for it (MonthPage only fetches its own month's range), and tapping it
 * would open a DaySheet for a date this page never loaded.
 */
function CalendarCell({
  day,
  items,
  isToday,
  isSelected,
  onPress,
}: {
  day: MonthDay;
  items: readonly ClothingItem[];
  isToday: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const dayOfMonth = Number(day.date.slice(-2));
  const hasOutfit = items.length > 0;

  if (!day.inMonth) {
    return (
      <View style={{ width: `${100 / CALENDAR_GRID_COLUMNS}%` }} className="p-1">
        <View className="aspect-[3/4] p-1">
          <Text className="text-xs font-sans-light text-ink-muted/40">{dayOfMonth}</Text>
        </View>
      </View>
    );
  }

  // Calendar numbers (design.md § Typography): Public Sans 400 for today,
  // the selected day, and any day with a logged outfit — past or future
  // otherwise reads the same, Public Sans 300, muted grey.
  const weightClass = isToday || isSelected || hasOutfit ? 'font-sans' : 'font-sans-light';
  const colorClass = isSelected ? 'text-accent' : isToday ? 'text-ink' : 'text-ink-muted';
  // Borderless per design.md's box-in-box rule — OutfitCollage already draws
  // its own edge, so this cell doesn't wrap it in a second bordered
  // rectangle. today/selected state reads through the day number's color
  // and a hairline underline instead of a ring around the whole cell.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ width: `${100 / CALENDAR_GRID_COLUMNS}%` }}
      className="p-1"
    >
      <View className="aspect-[3/4] overflow-hidden bg-paper">
        {items.length > 0 ? (
          <OutfitCollage items={items} />
        ) : (
          <View className="flex-1 items-center justify-center" />
        )}
        <Text className={`absolute top-0.5 left-1 text-xs ${weightClass} ${colorClass}`}>
          {dayOfMonth}
        </Text>
        {(isToday || isSelected) && (
          <View className={`absolute bottom-0 left-1 right-1 h-px ${isSelected ? 'bg-accent' : 'bg-ink'}`} />
        )}
      </View>
    </Pressable>
  );
}

function WeekdayHeader() {
  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <View className="flex-row px-2 bg-paper">
      {WEEKDAY_LABELS.map((label) => (
        <Text
          key={label}
          style={{ width: `${100 / CALENDAR_GRID_COLUMNS}%` }}
          className="text-center text-xs font-sans-medium text-ink-muted py-1"
        >
          {label}
        </Text>
      ))}
    </View>
  );
}

/**
 * One month's full 6-row grid (see monthGrid), with its own data fetch
 * scoped to just that month's date range — FlatList only mounts pages near
 * the visible one, so this keeps query cost proportional to what's actually
 * on screen, the same way the previous per-week rows did.
 */
function MonthPage({
  monthKey,
  today,
  selectedDate,
  onDayPress,
  onOutfitsLoaded,
  outfitsCache,
}: {
  monthKey: string;
  today: string;
  selectedDate: string | null;
  onDayPress: (date: string) => void;
  /** Reports this page's own fetch up to CalendarScreen, so tapping a visible day never re-queries a range this page already has. */
  onOutfitsLoaded: (outfitsByDate: ReadonlyMap<string, ClothingItem[]>) => void;
  /**
   * What each day cell actually renders reads through here — CalendarScreen's
   * own cache, not this page's local `outfitsByDate` state directly. The
   * cache starts populated from that same state (via onOutfitsLoaded below),
   * but unlike it, CalendarScreen can patch a single date in place after a
   * write (a removed outfit) without waiting for this useDbQuery to refetch
   * on its next focus — see CalendarScreen's confirmRemoveOutfit. Subscribing
   * here (rather than reading a value computed higher up) means this page
   * re-renders precisely when the cache itself changes, not only when
   * CalendarScreen happens to re-render for some other reason.
   */
  outfitsCache: OutfitsCache;
}) {
  const [start, end] = useMemo(() => monthDateRange(monthKey), [monthKey]);
  const { data: outfitsByDate } = useDbQuery((db) => listLoggedOutfitsInRange(db, start, end), [start, end]);
  const grid = useMemo(() => monthGrid(monthKey), [monthKey]);
  useSyncExternalStore(outfitsCache.subscribe, outfitsCache.getVersion);

  useEffect(() => {
    if (outfitsByDate) onOutfitsLoaded(outfitsByDate);
  }, [outfitsByDate, onOutfitsLoaded]);

  return (
    <View>
      {grid.map((week, i) => (
        <View key={i} className="flex-row px-1">
          {week.map((day) => (
            <CalendarCell
              key={day.date}
              day={day}
              items={outfitsCache.get(day.date)}
              isToday={day.date === today}
              isSelected={day.date === selectedDate}
              onPress={() => onDayPress(day.date)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * The panel that appears under a tapped day. If the day already has an
 * outfit logged, it shows that outfit; otherwise it's a prompt to log one.
 * Either way it's a fixed bottom sheet, not a full-screen modal, so a stray
 * tap while scrolling doesn't leave the calendar.
 */
function DaySheet({
  date,
  items,
  onLogOutfit,
  onRemoveOutfit,
  onDismiss,
}: {
  date: string;
  items: readonly ClothingItem[];
  onLogOutfit: () => void;
  onRemoveOutfit: () => void;
  onDismiss: () => void;
}) {
  const hasOutfit = items.length > 0;
  return (
    <BottomBar className="rounded-t-3xl shadow-lg">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-base font-sans-medium text-ink flex-1 mr-2" numberOfLines={1}>
          {formatLongDate(date)}
        </Text>
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10}>
          <Ionicons name="close" size={22} color="#6B6259" />
        </Pressable>
      </View>
      {hasOutfit && (
        <>
          <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted mb-2">Worn that day</Text>
          <View className="w-32 self-center mb-4">
            <OutfitCollage items={items} />
          </View>
        </>
      )}
      <Pressable onPress={onLogOutfit} accessibilityRole="button" className="rounded-sm py-3.5 items-center bg-ink">
        <Text className="text-paper font-sans-medium">{hasOutfit ? 'Edit outfit' : 'Log outfit'}</Text>
      </Pressable>
      {hasOutfit && (
        // Outlined, not filled -- this palette is deliberately neutral (see
        // tailwind.config.js), so "destructive" is signalled by weight
        // (outline vs. the solid "Edit outfit" above), not by introducing a
        // red the rest of the app never uses.
        <Pressable
          onPress={onRemoveOutfit}
          accessibilityRole="button"
          className="rounded-sm py-3.5 items-center mt-2 border border-ink"
        >
          <Text className="text-ink font-sans-medium">Remove outfit</Text>
        </Pressable>
      )}
    </BottomBar>
  );
}

/**
 * A regular monthly calendar — MONTHS_BEFORE/MONTHS_AFTER months either side
 * of today's, each a full 6-row month page (see utils/calendarGrid.ts)
 * flipped between horizontally, one page per screen width. Opens on the
 * month containing today. Tapping a day surfaces DaySheet rather than
 * navigating straight there; "Log outfit" (or "Edit outfit") in that sheet
 * is the only way into LogOutfitScreen.
 */
export function CalendarScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth } = useWindowDimensions();
  const today = todayDateString();
  const months = useMemo(() => monthsAround(new Date(), MONTHS_BEFORE, MONTHS_AFTER), []);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visibleMonthKey, setVisibleMonthKey] = useState(() => monthKeyForDate(today));
  const { invalidate: invalidateToday } = useTodayData();

  // Populated by whichever MonthPage's own query actually covers a given
  // date — the page for the visible month already fetches every day in it,
  // so a day tap reads from here instead of re-querying a range that's
  // already loaded. Backed by a plain mutable object (not React state)
  // because writes happen on every MonthPage mount/refetch and reads only
  // need to see current data when something actually taps in -- see
  // createOutfitsCache's own comment above for why that read goes through
  // useSyncExternalStore rather than a ref.
  const [outfitsCache] = useState(createOutfitsCache);

  const onOutfitsLoaded = useCallback(
    (outfitsByDate: ReadonlyMap<string, ClothingItem[]>) => outfitsCache.setMany(outfitsByDate),
    [outfitsCache],
  );

  const selectedDateItems = useSyncExternalStore(outfitsCache.subscribe, () =>
    selectedDate ? outfitsCache.get(selectedDate) : EMPTY_ITEMS,
  );

  const onDayPress = (date: string) => setSelectedDate((current) => (current === date ? null : date));
  const openLogOutfit = () => {
    if (!selectedDate) return;
    navigation.navigate('LogOutfit', { date: selectedDate });
    setSelectedDate(null);
  };

  const confirmRemoveOutfit = () => {
    if (!selectedDate) return;
    const date = selectedDate;
    Alert.alert('Remove this outfit?', 'This clears it from the calendar and undoes the wear it counted toward each item.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await withDb((db) => removeOutfitLogs(db, date));
              // Patched locally, not re-fetched -- same reasoning as
              // onOutfitsLoaded above: the write only changes this one
              // date's entry, so there's nothing a full requery would find
              // that setting it to empty here doesn't already reflect.
              outfitsCache.setOne(date, []);
              setSelectedDate(null);
              // wearCount feeds Today's recency ranking -- see
              // TodayDataContext's own doc comment for why nothing
              // refreshes its cached candidate pool on its own.
              invalidateToday();
            } catch (e) {
              console.error('Failed to remove outfit:', e);
              Alert.alert('Could not remove', 'That outfit is still logged.');
            }
          })();
        },
      },
    ]);
  };

  // Same shape as BouncingDots' fix (Task 1): FlatList requires
  // onViewableItemsChanged to keep the same identity across renders (like
  // VIEWABILITY_CONFIG above), so this used to be built once via
  // useRef(fn).current. That reads a ref's .current during render, which
  // react-hooks/refs flags for the same reason as the outfits cache above --
  // a lazy useState initializer is React's own mechanism for "create once,
  // read during render," so it participates in React's render-consistency
  // guarantees instead of reaching around them. setVisibleMonthKey is a
  // state setter, which React guarantees is stable for the component's
  // lifetime, so capturing it once here is safe.
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const visible = viewableItems[0];
        if (typeof visible?.item === 'string') setVisibleMonthKey(visible.item);
      },
  );

  // useWindowDimensions can report a stale/zero width for a frame or two on
  // the very first render — this app no longer waits behind an app-launch
  // splash before mounting (see § Startup in design.md), so the Calendar
  // screen can now be the first thing to mount at all, before the native
  // bridge has delivered a real measurement. A page width computed from that
  // bad value would make FlatList's one-shot initialScrollIndex jump land on
  // the wrong page and leave the true content unrendered at the wrong
  // horizontal offset until a manual swipe forced a remeasure — the same
  // failure mode the previous per-week vertical grid had. Not mounting the
  // FlatList at all until the width is real avoids it outright.
  const pageWidth = windowWidth;
  const widthReady = pageWidth > 0;

  const getItemLayout = useCallback(
    (_data: ArrayLike<string> | null | undefined, index: number) => ({
      length: pageWidth,
      offset: pageWidth * index,
      index,
    }),
    [pageWidth],
  );

  const listRef = useRef<FlatList<string>>(null);
  const onScrollToIndexFailed = useCallback(
    ({ index }: { index: number }) => {
      requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, animated: false }));
    },
    [],
  );

  return (
    <View className="flex-1 bg-paper">
      <Text className="px-3 pt-2 pb-1 text-xs font-sans-medium uppercase tracking-wide text-ink-muted">
        {monthLabelForKey(visibleMonthKey)}
      </Text>
      <WeekdayHeader />
      {widthReady ? (
        <FlatList
          ref={listRef}
          data={months}
          keyExtractor={(m) => m}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={MONTHS_BEFORE}
          // initialScrollIndex is a post-mount imperative jump and can lose
          // the race against the very first paint (the failure mode this
          // component used to have before the widthReady guard above: the
          // list would render starting from index 0 and briefly report that
          // as the viewable item before the jump landed, which is why the
          // header used to flash the wrong month and the page looked blank
          // until a manual swipe forced a remeasure). contentOffset instead
          // positions the list correctly for the very first frame, with no
          // jump required.
          contentOffset={{ x: MONTHS_BEFORE * pageWidth, y: 0 }}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={onScrollToIndexFailed}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY_CONFIG}
          initialNumToRender={1}
          windowSize={3}
          renderItem={({ item }) => (
            <View style={{ width: pageWidth }}>
              <MonthPage
                monthKey={item}
                today={today}
                selectedDate={selectedDate}
                onDayPress={onDayPress}
                onOutfitsLoaded={onOutfitsLoaded}
                outfitsCache={outfitsCache}
              />
            </View>
          )}
        />
      ) : (
        <View className="flex-1 items-center justify-center p-10">
          <ActivityIndicator />
        </View>
      )}
      {selectedDate && (
        <DaySheet
          date={selectedDate}
          items={selectedDateItems}
          onLogOutfit={openLogOutfit}
          onRemoveOutfit={confirmRemoveOutfit}
          onDismiss={() => setSelectedDate(null)}
        />
      )}
    </View>
  );
}
