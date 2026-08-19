import React from 'react';
import { ScrollView, Text, View } from 'react-native';

/**
 * Placeholder for outfit logging and wardrobe analytics (Phase 6).
 *
 * Nothing writes to Outfit_Logs yet — logging an outfit means generating one
 * first (Phase 5) and rendering a collage (Phase 6, which is also where the
 * project moves off Expo Go). Showing an empty month grid would imply the
 * table is being written to and simply isn't.
 */
export function CalendarScreen() {
  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
      <View className="bg-white rounded-2xl border border-slate-200 p-5">
        <Text className="text-base font-semibold text-slate-900">Nothing logged yet</Text>
        <Text className="text-sm text-slate-500 mt-2">
          Phase 6 adds the month grid, outfit collages, and the cost-per-wear and second-hand
          stats. Logging starts once the Today tab can generate an outfit to log.
        </Text>
      </View>
    </ScrollView>
  );
}
