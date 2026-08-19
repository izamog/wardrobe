import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StoredImage } from './StoredImage';
import type { ClothingItem } from '../types/wardrobe';

export type Badge = 'match' | 'dismatch' | 'unrated' | null;

/**
 * Columns in every item grid.
 *
 * Exported because ItemTile's width is a fraction of the row and the grid's
 * numColumns is set separately — they have to agree, and one constant is the
 * only way to be sure they do.
 */
export const GRID_COLUMNS = 3;

const BADGE_STYLE: Record<Exclude<Badge, null>, { label: string; className: string }> = {
  match: { label: '✓', className: 'bg-emerald-600' },
  dismatch: { label: '✕', className: 'bg-rose-600' },
  unrated: { label: '?', className: 'bg-slate-400' },
};

/**
 * A square item thumbnail.
 *
 * The placeholder is a normal state, not an error: an item can be added
 * without a photo, and items created before the camera existed have none.
 */
export function ItemTile({
  item,
  onPress,
  badge = null,
}: {
  item: ClothingItem;
  onPress: () => void;
  badge?: Badge;
}) {
  const badgeStyle = badge ? BADGE_STYLE[badge] : null;

  return (
    // w-1/3 rather than flex-1: with flex-1 a final row holding one item
    // stretches it to the full width, so a wardrobe of four showed three tiles
    // and one banner. A fixed third keeps every tile the same size whatever
    // the count. The fraction must match GRID_COLUMNS above.
    <Pressable onPress={onPress} className="w-1/3 p-1.5" accessibilityRole="button">
      <View className="aspect-[3/4] rounded-xl overflow-hidden bg-slate-100 items-center justify-center">
        <StoredImage
          path={item.imagePath}
          placeholder="No photo"
          placeholderClassName="text-slate-500 text-xs font-medium"
        />
        {badgeStyle && (
          <View
            className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full items-center justify-center ${badgeStyle.className}`}
          >
            <Text className="text-white text-sm font-bold">{badgeStyle.label}</Text>
          </View>
        )}
      </View>
      <Text className="text-xs font-semibold text-slate-900 mt-1.5" numberOfLines={1}>
        {item.brand}
      </Text>
      <Text className="text-[11px] text-slate-500" numberOfLines={1}>
        {item.category}
      </Text>
    </Pressable>
  );
}
