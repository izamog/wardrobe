import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StoredImage } from './StoredImage';
import { ItemPhotoBackdrop } from './ItemPhotoBackdrop';
import type { ClothingItem } from '../types/wardrobe';

export type Badge = 'match' | 'dismatch' | 'unrated' | null;

/**
 * Columns in every item grid — also the row width ItemGridRow expects.
 *
 * Exported because a caller's own chunking (see chunkIntoRows) and this
 * grid's own column layout have to agree, and one constant is the only way
 * to be sure they do.
 */
export const GRID_COLUMNS = 3;

const BADGE_STYLE: Record<
  Exclude<Badge, null>,
  { icon: React.ComponentProps<typeof Ionicons>['name']; className: string; label: string }
> = {
  match: { icon: 'checkmark', className: 'bg-success', label: 'Match' },
  dismatch: { icon: 'close', className: 'bg-rose-600', label: 'Dismatch' },
  unrated: { icon: 'help', className: 'bg-ink-muted', label: 'Unrated' },
};

/** The corner badge showing a match verdict — only ever one badge shown at a time with SelectionCircle. */
function BadgeCircle({ badge }: { badge: Exclude<Badge, null> }) {
  const style = BADGE_STYLE[badge];
  return (
    <View
      accessibilityLabel={style.label}
      className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full items-center justify-center ${style.className}`}
    >
      <Ionicons name={style.icon} size={16} color="#ffffff" />
    </View>
  );
}

/** The corner checkbox shown while bulk-select mode is active. */
function SelectionCircle({ selected }: { selected: boolean }) {
  return (
    <View
      accessibilityLabel={selected ? 'Selected' : 'Not selected'}
      className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full items-center justify-center border-2 border-paper ${
        selected ? 'bg-ink' : 'bg-paper/70'
      }`}
    >
      {selected && <Ionicons name="checkmark" size={14} color="#ffffff" />}
    </View>
  );
}

/**
 * One flush photo cell within an ItemGridRow's photo strip — no label, no
 * outer padding, no gap between it and its neighbours. The row (not this
 * cell) supplies the white label band beneath it.
 */
function PhotoCell({
  item,
  onPress,
  onLongPress,
  badge,
  selectable,
  selected,
}: {
  item: ClothingItem;
  onPress: () => void;
  onLongPress?: () => void;
  badge: Badge;
  selectable: boolean;
  selected: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      className="flex-1 aspect-[3/4]"
    >
      {/*
       * No decorative card border (per design.md's box-in-box rule) — a
       * border only appears while this cell is actually selected, which is
       * a real state signal, same as the selection circle badge below.
       */}
      <View
        className={`flex-1 overflow-hidden items-center justify-center ${
          selected ? 'border-2 border-ink' : ''
        }`}
      >
        <ItemPhotoBackdrop />
        <StoredImage
          path={item.imagePath}
          hasBakedMargin={item.imageMarginBaked}
          placeholder="No photo"
          placeholderClassName="text-ink-muted text-xs font-sans"
        />
        {badge && <BadgeCircle badge={badge} />}
        {selectable && <SelectionCircle selected={selected} />}
      </View>
    </Pressable>
  );
}

/** One column of the white label band, sitting under its matching PhotoCell. */
function LabelCell({ item, showCategory }: { item: ClothingItem; showCategory: boolean }) {
  return (
    <View className="flex-1 px-1.5 pt-1.5 pb-2">
      {/* text-sm (14px), not text-xs (12px): the previous size read as too
          small and its contrast margin was tighter than it needed to be. */}
      <Text className="text-sm font-brand tracking-wide text-ink" numberOfLines={1}>
        {item.brand}
      </Text>
      {showCategory && (
        <Text className="text-xs font-sans text-ink-muted mt-0.5" numberOfLines={1}>
          {item.category}
        </Text>
      )}
    </View>
  );
}

/** Splits a flat item list into GRID_COLUMNS-wide rows for ItemGridRow. */
export function chunkIntoRows<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += GRID_COLUMNS) rows.push(items.slice(i, i + GRID_COLUMNS));
  return rows;
}

/**
 * One row of up to GRID_COLUMNS garments, per design.md § Item grid rows:
 * a flush strip of photos with zero gap between them, then one continuous
 * white band spanning that same width holding each photo's brand name
 * directly beneath it — the label band belongs to the row, not to any one
 * item, so it is never a per-item card. A short final row (fewer than
 * GRID_COLUMNS items) is padded with empty cells in both the photo strip
 * and the label band, so columns still line up.
 */
export function ItemGridRow({
  items,
  onItemPress,
  onItemLongPress,
  selectable = false,
  isSelected,
  badgeFor,
  showCategory = true,
}: {
  items: readonly ClothingItem[];
  onItemPress: (item: ClothingItem) => void;
  onItemLongPress?: (item: ClothingItem) => void;
  /** Whether bulk-select mode is active — draws the checkbox circle on every cell, even unselected ones. */
  selectable?: boolean;
  isSelected?: (item: ClothingItem) => boolean;
  badgeFor?: (item: ClothingItem) => Badge;
  showCategory?: boolean;
}) {
  const padCount = GRID_COLUMNS - items.length;
  return (
    <View>
      <View className="flex-row">
        {items.map((item) => (
          <PhotoCell
            key={item.id}
            item={item}
            onPress={() => onItemPress(item)}
            onLongPress={onItemLongPress ? () => onItemLongPress(item) : undefined}
            badge={badgeFor?.(item) ?? null}
            selectable={selectable}
            selected={isSelected?.(item) ?? false}
          />
        ))}
        {Array.from({ length: padCount }, (_, i) => (
          <View key={`pad-photo-${i}`} className="flex-1" />
        ))}
      </View>
      <View className="flex-row bg-white">
        {items.map((item) => (
          <LabelCell key={item.id} item={item} showCategory={showCategory} />
        ))}
        {Array.from({ length: padCount }, (_, i) => (
          <View key={`pad-label-${i}`} className="flex-1" />
        ))}
      </View>
    </View>
  );
}
