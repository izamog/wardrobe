import React from 'react';
import { ScrollView, Text, View } from 'react-native';

/**
 * Placeholder for outfit logging and wardrobe analytics (Phase 6).
 *
 * Outfit_Logs is written to now — Phase 5's Today tab logs a row (and credits
 * each item's wearCount) whenever "Wear this outfit" is tapped — but nothing
 * reads it back yet. A month grid or a stat pulled from real rows still
 * belongs to Phase 6 (which is also where the project moves off Expo Go);
 * showing one here early would be guessing at layout, not displaying data.
 */
export function CalendarScreen() {
  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
      <View className="bg-white rounded-2xl border border-slate-200 p-5">
        <Text className="text-base font-semibold text-slate-900">Nothing to show yet</Text>
        <Text className="text-sm text-slate-500 mt-2">
          Phase 6 adds the month grid, outfit collages, and the cost-per-wear and second-hand
          stats, reading from the outfits you have already logged on the Today tab.
        </Text>
      </View>
    </ScrollView>
  );
}
