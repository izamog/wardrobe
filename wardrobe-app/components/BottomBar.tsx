import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A screen's fixed bottom action bar — Save, Log outfit, delete-selected,
 * and so on. Every one of these goes through this component rather than its
 * own `absolute bottom-0 ... p-4`: flat padding puts the button flush
 * against the device's bottom edge, under or right on top of the home
 * indicator on any device that has one. Padding for `insets.bottom` here is
 * the fundamental rule, not a per-screen judgement call — see AGENTS.md.
 *
 * Borderless on the same `paper` surface as the header and tab bar
 * (navigation/RootNavigator.tsx) — a top border here used to make this read
 * as a visually distinct bar sitting on top of the screen; dropping it lets
 * the bottom chrome blend into the same continuous surface as the top.
 */
export function BottomBar({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`absolute bottom-0 left-0 right-0 bg-paper px-5 pt-4 ${className}`}
      style={{ paddingBottom: Math.max(16, insets.bottom + 12) }}
    >
      {children}
    </View>
  );
}
