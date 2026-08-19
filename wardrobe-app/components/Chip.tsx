import React from 'react';
import { Pressable, Text } from 'react-native';

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
      className={`px-3.5 py-2 rounded-full mr-2 border ${
        selected ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-300'
      }`}
    >
      <Text className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-700'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
