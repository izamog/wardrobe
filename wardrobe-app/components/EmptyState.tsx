import React from 'react';
import { Text, View } from 'react-native';

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View className="flex-1 items-center justify-center p-10">
      {/* Not a screen title (font-sans-bold) — a short prominent message, so
          Public Sans 500, matching buttons/CTAs' weight for "prominent but
          not editorial" text. Detail is body copy: Public Sans 400. */}
      <Text className="text-base font-sans-medium text-ink text-center">{title}</Text>
      {detail ? (
        <Text className="text-sm font-sans text-ink-muted text-center mt-2">{detail}</Text>
      ) : null}
    </View>
  );
}
