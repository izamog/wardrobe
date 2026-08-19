import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StoredImage } from './StoredImage';
import type { ClothingItem } from '../types/wardrobe';

export type Badge = 'match' | 'dismatch' | 'unrated' | null;

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
    <Pressable onPress={onPress} className="flex-1 p-1.5" accessibilityRole="button">
      <View className="aspect-square rounded-xl overflow-hidden bg-slate-200 items-center justify-center">
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
