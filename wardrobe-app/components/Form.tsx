import React from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-4">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        {label}
      </Text>
      {children}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <Field label={label}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={keyboardType ?? 'default'}
        className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900"
      />
    </Field>
  );
}

export function SwitchField({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View className="mb-4 flex-row items-center justify-between">
      <Text className="text-sm font-medium text-slate-700">{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

/**
 * A single-choice row of options.
 *
 * Generic over the option type so the caller keeps its union — passing a
 * Category[] gives back a Category, not a string, which is what stops an
 * invalid value reaching a CHECK-constrained column.
 */
export function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <View className="flex-row flex-wrap">
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={`px-3 py-2 rounded-lg mr-2 mb-2 border ${
                selected ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-300'
              }`}
            >
              <Text className={`text-sm ${selected ? 'text-white' : 'text-slate-700'}`}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

/**
 * A 0-10 integer picker.
 *
 * Rendered as discrete buttons rather than a text input because the column has
 * CHECK (x BETWEEN 0 AND 10) — an out-of-range value simply cannot be entered.
 */
export function ScaleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <View className="flex-row flex-wrap">
        {Array.from({ length: 11 }, (_, n) => (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityRole="button"
            accessibilityState={{ selected: n === value }}
            className={`w-9 h-9 rounded-lg mr-1.5 mb-1.5 items-center justify-center border ${
              n === value ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-300'
            }`}
          >
            <Text className={`text-sm ${n === value ? 'text-white' : 'text-slate-700'}`}>{n}</Text>
          </Pressable>
        ))}
      </View>
    </Field>
  );
}

export function PrimaryButton({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
}) {
  const background = disabled
    ? 'bg-slate-300'
    : tone === 'danger'
      ? 'bg-rose-600'
      : 'bg-slate-900';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`rounded-xl py-3.5 items-center ${background}`}
    >
      <Text className="text-white font-semibold text-base">{label}</Text>
    </Pressable>
  );
}
