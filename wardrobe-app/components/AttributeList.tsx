import React, { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { MonthYearField, MultiSelectField, OptionRow } from './Form';
import { BouncingDots } from './BouncingDots';
import {
  ALL_CATEGORIES,
  backlessApplies,
  denierApplies,
  lengthApplies,
  lengthOptionsFor,
  materialPercentApplies,
  sleeveLengthApplies,
  thicknessApplies,
} from '../utils/categories';
import { ALL_COLORS, toColorPair } from '../utils/colors';
import { ALL_MATERIALS, reconcileMaterials } from '../utils/materials';
import { formatCost, formatPurchasedAtMonth, parseCost } from '../utils/format';
import type { Category, GarmentLength, ItemColor, MaterialEntry, SleeveLength, Thickness } from '../types/wardrobe';

const SLEEVE_LENGTHS: readonly SleeveLength[] = ['Sleeveless', 'Short', 'Long'];
const THICKNESSES: readonly Thickness[] = ['Mesh', 'Light', 'Regular', 'Thick', 'Heavy'];
/** Denier isn't a fixed vocabulary, so this field is entered as free text rather than picked from an OptionRow — see denierApplies in utils/categories.ts. */
const DENIER_MIN = 5;
const DENIER_MAX = 270;

/** Every attribute this list shows, in the order it shows them. */
export const ATTRIBUTE_FIELDS = [
  'category',
  'sleeveLength',
  'length',
  'thickness',
  'denier',
  'backless',
  'brand',
  'cost',
  'colors',
  'isSecondHand',
  'isWorkAppropriate',
  'materials',
  'purchasedAt',
] as const;

export type AttributeField = (typeof ATTRIBUTE_FIELDS)[number];

/** The attribute values being edited, ready to merge into the item. */
export interface AttributeValues {
  brand: string;
  costMinorUnits: number;
  primaryColor: ItemColor | '';
  secondaryColor: ItemColor | '';
  category: Category;
  sleeveLength: SleeveLength;
  length: GarmentLength | '';
  thickness: Thickness;
  denier: number;
  backless: boolean;
  isSecondHand: boolean;
  isWorkAppropriate: boolean;
  materials: MaterialEntry[];
  purchasedAt: string;
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
/** Where a row's value currently stands. */
interface AttributeRowStatus {
  pending: boolean;
  /** Something is still working this value out; the row shows dots instead. */
  loading: boolean;
  expanded: boolean;
}

function AttributeRow({
  label,
  value,
  status,
  onAccept,
  onEdit,
  children,
}: {
  label: string;
  value: string;
  status: AttributeRowStatus;
  onAccept: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const { pending, loading, expanded } = status;
  return (
    <View className="border-b border-paper-2">
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        className="flex-row items-center px-4 py-3"
      >
        <Text className="text-sm font-sans text-ink-muted w-24">{label}</Text>
        {loading ? (
          <View className="flex-1 mr-3 justify-center">
            <BouncingDots color="#6B6259" />
          </View>
        ) : (
          <Text
            className={`flex-1 text-sm font-sans-medium mr-3 ${
              pending ? 'text-ink' : 'text-ink-muted'
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
              className="w-11 h-11 rounded-full bg-paper-2 border border-rule items-center justify-center mr-2"
            >
              <Ionicons name="close" size={18} color="#6B6259" />
            </Pressable>
            <Pressable
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel={`Accept ${label}`}
              className="w-11 h-11 rounded-full bg-accent items-center justify-center"
            >
              <Ionicons name="checkmark" size={18} color="#ffffff" />
            </Pressable>
          </View>
        ) : (
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#6B6259" />
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
  const [denierText, setDenierText] = useState('');

  const openEditor = (field: AttributeField) => {
    if (field === 'cost') setCostText((values.costMinorUnits / 100).toFixed(2));
    if (field === 'denier') setDenierText(values.denier === 0 ? '' : String(values.denier));
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
      status={{
        pending: pending.has(field),
        loading: loading?.has(field) ?? false,
        expanded: expanded === field,
      }}
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
    <View className="bg-paper">
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

      {sleeveLengthApplies(values.category) &&
        row(
          'sleeveLength',
          'Sleeves',
          values.sleeveLength,
          <OptionRow
            label=""
            options={SLEEVE_LENGTHS}
            value={values.sleeveLength}
            onChange={(sleeveLength) => {
              onChange({ sleeveLength });
              onResolve('sleeveLength');
              setExpanded(null);
            }}
          />,
        )}

      {lengthApplies(values.category) &&
        row(
          'length',
          'Length',
          values.length,
          <OptionRow
            label=""
            options={lengthOptionsFor(values.category)}
            value={values.length}
            onChange={(length) => {
              onChange({ length });
              onResolve('length');
              setExpanded(null);
            }}
          />,
        )}

      {thicknessApplies(values.category) &&
        row(
          'thickness',
          'Thickness',
          values.thickness,
          <OptionRow
            label=""
            options={THICKNESSES}
            value={values.thickness}
            onChange={(thickness) => {
              onChange({ thickness });
              onResolve('thickness');
              setExpanded(null);
            }}
          />,
        )}

      {denierApplies(values.category) &&
        row(
          'denier',
          'Denier',
          values.denier === 0 ? '' : String(values.denier),
          // See TextField's own comment in components/Form.tsx: the box is a
          // fixed-height wrapper that flex-centers the TextInput, rather than
          // padding or textAlignVertical on the TextInput itself, so a custom
          // font's own line-height metrics can't skew the text off-centre.
          <View className="bg-paper border border-rule rounded-sm h-11 px-3 justify-center">
            <TextInput
              value={denierText}
              onChangeText={setDenierText}
              onEndEditing={() => {
                // Free typing is allowed on the way in (an in-progress "2" of
                // "270" would otherwise get clamped up to 5 the moment it's
                // typed, making a three-digit denier impossible to enter) —
                // parsing, clamping into the CHECK constraint's own [5, 270]
                // range and committing only happens once editing finishes, the
                // same deferred-commit shape the cost field uses via costText.
                const parsed = Number(denierText);
                const denier =
                  denierText.trim() === '' || !Number.isFinite(parsed)
                    ? 0
                    : Math.round(Math.min(DENIER_MAX, Math.max(DENIER_MIN, parsed)));
                onChange({ denier });
                setDenierText(denier === 0 ? '' : String(denier));
                onResolve('denier');
              }}
              keyboardType="number-pad"
              placeholder={`${DENIER_MIN}-${DENIER_MAX}`}
              placeholderTextColor="#6B6259"
              // See TextField's own comment in components/Form.tsx: text-base's
              // default 24px lineHeight against a 16px font is visibly
              // asymmetric on all-digit content specifically, so it's pulled
              // back down close to the font size here.
              style={{ lineHeight: 18 }}
              className="p-0 text-base font-sans-medium text-ink"
            />
          </View>,
        )}

      {backlessApplies(values.category) &&
        row(
          'backless',
          'Backless',
          values.backless ? 'Yes' : 'No',
          <View className="flex-row items-center justify-between py-1">
            <Text className="text-sm font-sans text-ink-muted">Open back</Text>
            <Switch
              value={values.backless}
              onValueChange={(backless) => {
                onChange({ backless });
                onResolve('backless');
              }}
            />
          </View>,
        )}

      {row(
        'brand',
        'Brand',
        values.brand === 'Unknown' ? '' : values.brand,
        <View className="bg-paper border border-rule rounded-sm h-11 px-3 justify-center">
          <TextInput
            value={values.brand === 'Unknown' ? '' : values.brand}
            onChangeText={(brand) => onChange({ brand })}
            onEndEditing={() => onResolve('brand')}
            placeholder="Type the brand"
            placeholderTextColor="#6B6259"
            autoFocus
            style={{ lineHeight: 18 }}
            className="p-0 text-base font-sans-medium text-ink"
          />
        </View>,
      )}

      {row(
        'cost',
        'Cost',
        formatCost(values.costMinorUnits),
        <View className="bg-paper border border-rule rounded-sm h-11 px-3 justify-center">
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
            placeholderTextColor="#6B6259"
            autoFocus
            style={{ lineHeight: 18 }}
            className="p-0 text-base font-sans-medium text-ink"
          />
        </View>,
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
          <Text className="text-sm font-sans text-ink-muted">Bought second-hand</Text>
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
        'isWorkAppropriate',
        'Work appropriate',
        values.isWorkAppropriate ? 'Yes' : 'No',
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-sm font-sans text-ink-muted">Work appropriate</Text>
          <Switch
            value={values.isWorkAppropriate}
            onValueChange={(isWorkAppropriate) => {
              onChange({ isWorkAppropriate });
              onResolve('isWorkAppropriate');
            }}
          />
        </View>,
      )}

      {row(
        'materials',
        'Materials',
        values.materials.map((m) => (m.percent > 0 ? `${m.material} (${m.percent}%)` : m.material)).join(', '),
        <>
          <MultiSelectField
            label=""
            options={ALL_MATERIALS}
            selected={values.materials.map((m) => m.material)}
            onChange={(names) => {
              onChange({ materials: reconcileMaterials(values.materials, names) });
              onResolve('materials');
            }}
            emptyLabel="Select materials"
            maxSelected={2}
          />
          {materialPercentApplies(values.category) &&
            values.materials.map((entry) => (
              <View key={entry.material} className="flex-row items-center justify-between mt-2">
                <Text className="text-sm font-sans text-ink-muted">{entry.material} %</Text>
                <View className="bg-paper border border-rule rounded-sm h-11 px-3 justify-center w-20">
                  <TextInput
                    value={entry.percent === 0 ? '' : String(entry.percent)}
                    onChangeText={(text) => {
                      const parsed = Number(text);
                      const percent =
                        text.trim() === '' || !Number.isInteger(parsed)
                          ? 0
                          : Math.min(100, Math.max(0, parsed));
                      onChange({
                        materials: values.materials.map((m) =>
                          m.material === entry.material ? { ...m, percent } : m,
                        ),
                      });
                    }}
                    onEndEditing={() => onResolve('materials')}
                    keyboardType="number-pad"
                    placeholder="0-100"
                    placeholderTextColor="#6B6259"
                    style={{ lineHeight: 18 }}
                    className="p-0 text-base font-sans-medium text-ink text-right"
                  />
                </View>
              </View>
            ))}
          {materialPercentApplies(values.category) && values.materials.length > 0 && (
            <Text className="text-xs font-sans text-ink-muted mt-1">
              Doesn&apos;t need to add up to 100% — leave a material blank if you don&apos;t know its share.
            </Text>
          )}
        </>,
      )}

      {row(
        'purchasedAt',
        'Bought',
        formatPurchasedAtMonth(values.purchasedAt),
        <MonthYearField
          label=""
          value={values.purchasedAt}
          onChange={(purchasedAt) => {
            onChange({ purchasedAt });
            onResolve('purchasedAt');
          }}
        />,
      )}
    </View>
  );
}
