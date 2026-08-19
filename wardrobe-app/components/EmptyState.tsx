import React from 'react';
import { Text, View } from 'react-native';

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View className="flex-1 items-center justify-center p-10">
      <Text className="text-base font-semibold text-slate-600 text-center">{title}</Text>
      {detail ? (
        <Text className="text-sm text-slate-400 text-center mt-2">{detail}</Text>
      ) : null}
    </View>
  );
}
