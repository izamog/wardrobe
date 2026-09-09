import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatPurchasedAtMonth, MONTH_NAMES } from '../utils/format';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-4">
      {/* A form field's own label — same role as an item-metadata list-row
          label: Public Sans 400. */}
      <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted mb-1.5">
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
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  maxLength?: number;
}) {
  return (
    <Field label={label}>
      {/* The border, background and fixed height live on this wrapper, not
          the TextInput itself, and the wrapper centers it with flexbox
          rather than padding or textAlignVertical on the TextInput -- see
          this file's own history for why. That alone wasn't enough: `text-
          base` carries Tailwind's default lineHeight (24) against a 16px
          font, an 8px box inflation a Text component distributes evenly
          around the glyphs but a native TextInput does not always split the
          same way -- most visible on all-digit content, which has no
          descenders to fill the lower half of that inflated box the way
          mixed-case text does. lineHeight is pulled back down close to the
          font size here so there is barely any inflation left to be
          asymmetric about. */}
      <View className="bg-paper border border-rule rounded-sm h-11 px-3 justify-center">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#6B6259"
          keyboardType={keyboardType ?? 'default'}
          maxLength={maxLength}
          style={{ lineHeight: 18 }}
          className="p-0 text-base font-sans-medium text-ink"
        />
      </View>
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
      <Text className="text-sm font-sans text-ink-muted">{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: '#6B1F2A' }} />
    </View>
  );
}

/**
 * One chip in a single-choice row — the shared rendering OptionRow, YearRow
 * and MonthGrid below all pick from. `wrap` adds the bottom margin a
 * flex-wrap grid needs between rows; a single horizontal scroll row (YearRow)
 * doesn't wrap, so it skips that margin.
 */
function OptionChip({
  label,
  selected,
  onPress,
  wrap = true,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  wrap?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`px-3 py-2 rounded-sm mr-2 border ${wrap ? 'mb-2' : ''} ${
        selected ? 'bg-ink border-ink' : 'bg-paper border-rule'
      }`}
    >
      <Text className={`text-sm font-sans ${selected ? 'text-paper' : 'text-ink-muted'}`}>{label}</Text>
    </Pressable>
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
        {options.map((option) => (
          <OptionChip key={option} label={option} selected={option === value} onPress={() => onChange(option)} />
        ))}
      </View>
    </Field>
  );
}

/** How many years back the picker offers, from the current year. */
const MONTH_YEAR_PICKER_YEARS_BACK = 25;

/** The scrollable row of candidate years, pulled out of MonthYearField to keep it under the line-count lint rule. */
function YearRow({ years, selected, onSelect }: { years: number[]; selected: number; onSelect: (year: number) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
      <View className="flex-row">
        {years.map((year) => (
          <OptionChip
            key={year}
            label={String(year)}
            selected={year === selected}
            onPress={() => onSelect(year)}
            wrap={false}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/** The wrapped grid of month chips, pulled out of MonthYearField for the same reason as YearRow. */
function MonthGrid({ selectedIndex, onSelect }: { selectedIndex: number; onSelect: (index: number) => void }) {
  return (
    <View className="flex-row flex-wrap mb-4">
      {MONTH_NAMES.map((month, index) => (
        <OptionChip key={month} label={month} selected={index === selectedIndex} onPress={() => onSelect(index)} />
      ))}
    </View>
  );
}

/**
 * A field that opens a month/year picker and writes a "YYYY-MM" value (see
 * parsePurchasedAtMonth in utils/format.ts) — or "" for "not recorded".
 *
 * Two independent chip rows rather than a single scrolling list of "March
 * 2024" entries: a list spanning MONTH_YEAR_PICKER_YEARS_BACK years would be
 * 300+ rows to scroll through for what is usually a "a couple of years ago"
 * guess, not a precise date. Picking a year first, then a month, is a
 * constant-size choice regardless of how far back the range goes.
 */
export function MonthYearField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = useMemo(() => new Date(), []);
  const [storedYear, storedMonth] = value ? value.split('-') : ['', ''];
  const [pendingYear, setPendingYear] = useState(() => (storedYear ? Number(storedYear) : now.getFullYear()));
  const [pendingMonthIndex, setPendingMonthIndex] = useState(() =>
    storedMonth ? Number(storedMonth) - 1 : now.getMonth(),
  );

  const years = useMemo(() => {
    const currentYear = now.getFullYear();
    return Array.from({ length: MONTH_YEAR_PICKER_YEARS_BACK + 1 }, (_, i) => currentYear - i);
  }, [now]);

  const openPicker = () => {
    setPendingYear(storedYear ? Number(storedYear) : now.getFullYear());
    setPendingMonthIndex(storedMonth ? Number(storedMonth) - 1 : now.getMonth());
    setOpen(true);
  };

  const save = () => {
    onChange(`${pendingYear}-${String(pendingMonthIndex + 1).padStart(2, '0')}`);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  return (
    <Field label={label}>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        className="bg-paper border border-rule rounded-sm px-3 py-2.5 flex-row justify-between items-center"
      >
        <Text className={`text-base font-sans-medium flex-1 ${value ? 'text-ink' : 'text-ink-muted'}`} numberOfLines={1}>
          {value ? formatPurchasedAtMonth(value) : 'Not set'}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#6B6259" style={{ marginLeft: 8 }} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-paper">
          <View className="flex-row items-center justify-between pl-5 pr-3 pt-6 pb-3 bg-paper border-b border-rule">
            <Text className="text-lg font-sans-medium text-ink">{label}</Text>
            <Pressable onPress={save} accessibilityRole="button" className="px-5 py-3 rounded-sm bg-ink">
              <Text className="text-base font-sans-medium text-paper">Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="p-4 pb-10">
            <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted mb-1.5">Year</Text>
            <YearRow years={years} selected={pendingYear} onSelect={setPendingYear} />

            <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted mb-1.5">Month</Text>
            <MonthGrid selectedIndex={pendingMonthIndex} onSelect={setPendingMonthIndex} />

            {value ? (
              <Pressable onPress={clear} accessibilityRole="button" hitSlop={8} className="py-3">
                <Text className="text-sm font-sans-medium text-rose-600">Clear</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
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
        className={`rounded-sm py-3.5 items-center border ${
          disabled ? 'border-rule' : 'border-rule bg-paper'
        }`}
      >
        <Text className={`font-sans-medium text-base ${disabled ? 'text-ink-muted/50' : 'text-ink'}`}>
          {label}
        </Text>
      </Pressable>
    );
  }

  const background = disabled ? 'bg-rule' : tone === 'danger' ? 'bg-rose-600' : 'bg-ink';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`rounded-sm py-3.5 items-center ${background}`}
    >
      <Text className="text-paper font-sans-medium text-base">{label}</Text>
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
 *
 * `maxSelected`, when given, blocks ticking a further option once the cap is
 * reached rather than silently truncating on save — unlike Colours (capped
 * the same way but by toColorPair, since only two DB columns exist to hold
 * the result), nothing downstream of Materials enforces a limit on its own,
 * so the field has to be the one place the rule actually lives.
 */
export function MultiSelectField({
  label,
  options,
  selected,
  onChange,
  emptyLabel = 'None selected',
  maxSelected,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  maxSelected?: number;
}) {
  const [open, setOpen] = useState(false);

  const allOptions = useMemo(() => {
    const unknown = selected.filter((value) => !options.includes(value));
    return [...unknown, ...options];
  }, [options, selected]);

  const atCap = maxSelected !== undefined && selected.length >= maxSelected;

  const toggle = (value: string) => {
    const alreadySelected = selected.includes(value);
    if (!alreadySelected && atCap) return;
    const next = alreadySelected ? selected.filter((entry) => entry !== value) : [...selected, value];
    // Kept in the options' own order so the stored list does not depend on the
    // order the user happened to tap.
    onChange(allOptions.filter((entry) => next.includes(entry)));
  };

  return (
    <Field label={label}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="bg-paper border border-rule rounded-sm px-3 py-2.5 flex-row justify-between items-center"
      >
        <Text
          className={`text-base font-sans-medium flex-1 ${selected.length ? 'text-ink' : 'text-ink-muted'}`}
          numberOfLines={1}
        >
          {selected.length ? selected.join(', ') : emptyLabel}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#6B6259" style={{ marginLeft: 8 }} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-paper">
          {/* pt-6 clears the sheet's rounded top corners — at pt-3 the title and
              the Done button sat in the curve. */}
          <View className="flex-row items-center justify-between pl-5 pr-3 pt-6 pb-3 bg-paper border-b border-rule">
            <Text className="text-lg font-sans-medium text-ink">{label}</Text>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              // Padding inside the Pressable, so the tap target is the whole
              // pill rather than the glyphs. A bare text label here was a
              // ~40x20pt target and easy to miss.
              className="px-5 py-2.5 rounded-sm bg-ink"
            >
              <Text className="text-base font-sans-medium text-paper">Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="pb-10">
            {allOptions.map((option) => {
              const isSelected = selected.includes(option);
              const disabled = !isSelected && atCap;
              return (
                <Pressable
                  key={option}
                  onPress={() => toggle(option)}
                  disabled={disabled}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected, disabled }}
                  className="flex-row items-center justify-between px-4 py-3.5 bg-paper border-b border-rule"
                >
                  <Text className={`text-base font-sans-medium ${disabled ? 'text-ink-muted/40' : 'text-ink'}`}>
                    {option}
                  </Text>
                  {isSelected ? <Ionicons name="checkmark" size={20} color="#1A1714" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </Field>
  );
}
