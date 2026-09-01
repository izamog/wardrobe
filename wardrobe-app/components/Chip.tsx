import React from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * A category filter "tab" — plain text with an ink underline when selected,
 * not a filled pill. Matches the studied DNA's own filter row (Burberry's
 * category filters are plain text links, not chip buttons) and reads as a
 * row of tabs rather than a row of buttons — see design.md.
 */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      className="mr-5 pb-2 items-center"
    >
      {/* Category tabs: Public Sans 400 always — see design.md § Typography.
          The selected/unselected distinction is colour + the underline
          below, not weight; font-semibold/font-medium were plain-weight
          utilities that do nothing once a named custom font is set anyway. */}
      <Text className={`text-sm font-sans ${selected ? 'text-ink' : 'text-ink-muted'}`}>
        {label}
      </Text>
      <View className={`h-[1.5px] w-full mt-1.5 ${selected ? 'bg-ink' : 'bg-transparent'}`} />
    </Pressable>
  );
}
