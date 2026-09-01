import React from 'react';
import { Image, View } from 'react-native';
import { imageUriFor } from '../services/images';
import type { ClothingItem } from '../types/wardrobe';
import { collageLayout, isCutout, type SlotRect } from '../utils/outfitCollageLayout';

function CollagePiece({ item, slot }: { item: ClothingItem; slot: SlotRect }) {
  const uri = imageUriFor(item.imagePath);
  if (!uri) return null;

  const image = (
    <Image source={{ uri }} resizeMode="contain" className="w-full h-full" accessibilityLabel={item.category} />
  );

  return (
    <View
      style={{
        position: 'absolute',
        top: `${slot.top}%`,
        left: `${slot.left}%`,
        width: `${slot.width}%`,
        height: `${slot.height}%`,
        zIndex: slot.z,
      }}
    >
      {isCutout(item.imagePath) ? (
        image
      ) : (
        // No background-removal cutout for this item: given a plain,
        // borderless paper-toned backing instead of pretending it's a clean
        // cutout, since its own background would otherwise sit as a visible
        // rectangle on the canvas — but per design.md's box-in-box rule this
        // is a flat backing, not a bordered card: no border, no shadow, no
        // rounding, so it doesn't read as a second box nested on the canvas.
        <View className="w-full h-full items-center justify-center bg-paper">{image}</View>
      )}
    </View>
  );
}

/**
 * A flat-lay style arrangement of an outfit's items on a 3:4 canvas, laid
 * out on an explicit 5x5 grid — see utils/outfitCollageLayout.ts for the
 * exact per-category placement rules and why the slots overlap rather than
 * tiling edge-to-edge.
 *
 * Deliberately borderless (see design.md § The box-in-box rule): every
 * caller that places this inside its own container (TodayScreen's outfit
 * cards, CalendarScreen's day cells) must not re-wrap it in a bordered
 * rectangle — this canvas already IS the visual unit.
 */
export function OutfitCollage({ items }: { items: readonly ClothingItem[] }) {
  const slots = collageLayout(items);
  return (
    <View className="w-full aspect-[3/4] overflow-hidden bg-paper">
      {items.map((item, i) => (
        <CollagePiece key={item.id} item={item} slot={slots[i]} />
      ))}
    </View>
  );
}
