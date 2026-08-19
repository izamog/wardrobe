import React, { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { MultiSelectField, OptionRow } from './Form';
import { BouncingDots } from './BouncingDots';
import { ALL_CATEGORIES } from '../utils/categories';
import { ALL_COLORS, toColorPair } from '../utils/colors';
import { ALL_MATERIALS } from '../utils/materials';
import { formatCost, parseCost } from '../utils/format';
import type { Category, ItemColor } from '../types/wardrobe';

/** Every attribute this list shows, in the order it shows them. */
export const ATTRIBUTE_FIELDS = [
  'category',
  'brand',
  'cost',
  'colors',
  'isSecondHand',
  'materials',
] as const;

export type AttributeField = (typeof ATTRIBUTE_FIELDS)[number];

/** The attribute values being edited, ready to merge into the item. */
export interface AttributeValues {
  brand: string;
  costMinorUnits: number;
  primaryColor: ItemColor | '';
  secondaryColor: ItemColor | '';
  category: Category;
  isSecondHand: boolean;
  materials: string[];
}

/**
 * One attribute: a label, its current value, and a way to change it.
 *
 * The same row whether the value was typed, defaulted or heard. An earlier
 * version rendered proposed attributes as cards and un-proposed ones as form
 * controls, so the screen rearranged itself the moment a recording finished
 * and the category moved. Only the trailing control differs now: a pending
 * suggestion offers accept and reject, anything else offers edit.
 */
function AttributeRow({
  label,
  value,
  pending,
  loading,
  expanded,
  onAccept,
  onEdit,
  children,
}: {
  label: string;
  value: string;
  pending: boolean;
  /** Something is still working this value out; the row shows dots instead. */
  loading: boolean;
  expanded: boolean;
  onAccept: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <View className="border-b border-slate-100">
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        className="flex-row items-center px-4 py-3"
      >
        <Text className="text-sm text-slate-500 w-24">{label}</Text>
        {loading ? (
          <View className="flex-1 mr-3 justify-center">
            <BouncingDots color="#94a3b8" />
          </View>
        ) : (
          <Text
            className={`flex-1 text-sm font-medium mr-3 ${
              pending ? 'text-slate-900' : 'text-slate-700'
            }`}
            numberOfLines={1}
          >
            {value || '—'}
          </Text>
        )}

        {pending ? (
          <View className="flex-row">
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel={`Reject ${label}`}
              className="w-10 h-10 rounded-full bg-slate-100 border border-slate-300 items-center justify-center mr-2"
            >
              <Ionicons name="close" size={18} color="#334155" />
            </Pressable>
            <Pressable
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel={`Accept ${label}`}
              className="w-10 h-10 rounded-full bg-emerald-600 items-center justify-center"
            >
              <Ionicons name="checkmark" size={18} color="#ffffff" />
            </Pressable>
          </View>
        ) : (
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
        )}
      </Pressable>

      {expanded ? <View className="px-4 pb-3">{children}</View> : null}
    </View>
  );
}

/**
 * The full attribute list, identical before and after anything is heard.
 *
 * `pending` names the fields a recording proposed that have not been confirmed
 * yet; they are the only ones that look any different.
 */
export function AttributeList({
  values,
  pending,
  loading,
  onChange,
  onResolve,
}: {
  values: AttributeValues;
  pending: ReadonlySet<AttributeField>;
  /** Fields still being worked out in the background, shown as dots. */
  loading?: ReadonlySet<AttributeField>;
  onChange: (patch: Partial<AttributeValues>) => void;
  onResolve: (field: AttributeField) => void;
}) {
  const [expanded, setExpanded] = useState<AttributeField | null>(null);
  const [costText, setCostText] = useState('');

  const openEditor = (field: AttributeField) => {
    if (field === 'cost') setCostText((values.costMinorUnits / 100).toFixed(2));
    setExpanded(expanded === field ? null : field);
  };

  const selectedColors = [values.primaryColor, values.secondaryColor].filter(
    (color): color is ItemColor => color !== '',
  );

  const row = (field: AttributeField, label: string, value: string, editor: React.ReactNode) => (
    <AttributeRow
      key={field}
      label={label}
      value={value}
      pending={pending.has(field)}
      loading={loading?.has(field) ?? false}
      expanded={expanded === field}
      onAccept={() => {
        onResolve(field);
        setExpanded(null);
      }}
      onEdit={() => openEditor(field)}
    >
      {editor}
    </AttributeRow>
  );

  return (
    <View className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {row(
        'category',
        'Category',
        values.category,
        <OptionRow
          label=""
          options={ALL_CATEGORIES}
          value={values.category}
          onChange={(category) => {
            onChange({ category });
            onResolve('category');
            setExpanded(null);
          }}
        />,
      )}

      {row(
        'brand',
        'Brand',
        values.brand === 'Unknown' ? '' : values.brand,
        <TextInput
          value={values.brand === 'Unknown' ? '' : values.brand}
          onChangeText={(brand) => onChange({ brand })}
          onEndEditing={() => onResolve('brand')}
          placeholder="Type the brand"
          placeholderTextColor="#94a3b8"
          autoFocus
          className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900"
        />,
      )}

      {row(
        'cost',
        'Cost',
        formatCost(values.costMinorUnits),
        <TextInput
          value={costText}
          onChangeText={(text) => {
            setCostText(text);
            const parsed = parseCost(text);
            if (parsed !== null) onChange({ costMinorUnits: parsed });
          }}
          onEndEditing={() => onResolve('cost')}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor="#94a3b8"
          autoFocus
          className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900"
        />,
      )}

      {row(
        'colors',
        'Colour',
        selectedColors.join(' / '),
        <MultiSelectField
          label=""
          options={ALL_COLORS}
          selected={selectedColors}
          onChange={(next) => {
            onChange(toColorPair(next as ItemColor[]));
            onResolve('colors');
          }}
          emptyLabel="Select colours"
        />,
      )}

      {row(
        'isSecondHand',
        'Condition',
        values.isSecondHand ? 'Second-hand' : 'New',
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-sm text-slate-700">Bought second-hand</Text>
          <Switch
            value={values.isSecondHand}
            onValueChange={(isSecondHand) => {
              onChange({ isSecondHand });
              onResolve('isSecondHand');
            }}
          />
        </View>,
      )}

      {row(
        'materials',
        'Materials',
        values.materials.join(', '),
        <MultiSelectField
          label=""
          options={ALL_MATERIALS}
          selected={values.materials}
          onChange={(materials) => {
            onChange({ materials });
            onResolve('materials');
          }}
          emptyLabel="Select materials"
        />,
      )}
    </View>
  );
}
