import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

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
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
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

export function PrimaryButton({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  if (tone === 'secondary') {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        className={`rounded-xl py-3.5 items-center border ${
          disabled ? 'border-slate-200' : 'border-slate-300 bg-white'
        }`}
      >
        <Text className={`font-semibold text-base ${disabled ? 'text-slate-300' : 'text-slate-700'}`}>
          {label}
        </Text>
      </Pressable>
    );
  }

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

/**
 * A field that opens a list and lets several entries be ticked.
 *
 * A modal rather than an inline expansion because the option list is long
 * enough to push everything below it off screen, and because the closed state
 * needs to read as a single value — the summary line — not as a wall of chips.
 *
 * `options` is extended with anything already selected but not offered, so a
 * value written by an older build (or a future one) survives an edit here
 * instead of being silently dropped on save.
 */
export function MultiSelectField({
  label,
  options,
  selected,
  onChange,
  emptyLabel = 'None selected',
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  const allOptions = useMemo(() => {
    const unknown = selected.filter((value) => !options.includes(value));
    return [...unknown, ...options];
  }, [options, selected]);

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value];
    // Kept in the options' own order so the stored list does not depend on the
    // order the user happened to tap.
    onChange(allOptions.filter((entry) => next.includes(entry)));
  };

  return (
    <Field label={label}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 flex-row justify-between items-center"
      >
        <Text
          className={`text-base flex-1 ${selected.length ? 'text-slate-900' : 'text-slate-400'}`}
          numberOfLines={1}
        >
          {selected.length ? selected.join(', ') : emptyLabel}
        </Text>
        <Text className="text-slate-400 ml-2">▾</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-slate-50">
          {/* pt-6 clears the sheet's rounded top corners — at pt-3 the title and
              the Done button sat in the curve. */}
          <View className="flex-row items-center justify-between pl-5 pr-3 pt-6 pb-3 bg-white border-b border-slate-200">
            <Text className="text-lg font-semibold text-slate-900">{label}</Text>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              // Padding inside the Pressable, so the tap target is the whole
              // pill rather than the glyphs. A bare text label here was a
              // ~40x20pt target and easy to miss.
              className="px-5 py-2.5 rounded-full bg-slate-900"
            >
              <Text className="text-base font-semibold text-white">Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="pb-10">
            {allOptions.map((option) => {
              const isSelected = selected.includes(option);
              return (
                <Pressable
                  key={option}
                  onPress={() => toggle(option)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  className="flex-row items-center justify-between px-4 py-3.5 bg-white border-b border-slate-100"
                >
                  <Text className="text-base text-slate-900">{option}</Text>
                  {isSelected ? <Text className="text-lg text-slate-900">✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </Field>
  );
}
