import React, { useMemo, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { MultiSelectField, OptionRow } from './Form';
import { ALL_CATEGORIES } from '../utils/categories';
import { ALL_COLORS, toColorPair } from '../utils/colors';
import { ALL_MATERIALS } from '../utils/materials';
import { formatCost, parseCost } from '../utils/format';
import type { ItemProposal } from '../utils/proposals';
import type { Category, ItemColor } from '../types/wardrobe';

/** The fields a person confirms. The rest of a proposal is applied without asking. */
export type ReviewableField =
  | 'brand'
  | 'cost'
  | 'colors'
  | 'category'
  | 'isSecondHand'
  | 'materials';

/** The attribute values a review produces, ready to merge into the item being created. */
export interface ReviewedValues {
  brand: string;
  costMinorUnits: number;
  primaryColor: ItemColor | '';
  secondaryColor: ItemColor | '';
  category: Category;
  isSecondHand: boolean;
  materials: string[];
}

/**
 * One proposed attribute, with the two things a person can do about it.
 *
 * Rejecting opens the editor rather than discarding the field, because the
 * model being wrong is the moment the correct value is most worth capturing —
 * dismissing it would push the work to a screen the user has not opened yet.
 */
function ProposalCard({
  label,
  value,
  resolved,
  onAccept,
  onReject,
  editing,
  children,
}: {
  label: string;
  value: string;
  resolved: boolean;
  onAccept: () => void;
  onReject: () => void;
  editing: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      className={`rounded-xl border mb-3 overflow-hidden ${
        resolved ? 'border-slate-200 bg-slate-100' : 'border-slate-300 bg-white'
      }`}
    >
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="flex-1 mr-3">
          <Text className="text-xs uppercase tracking-wide text-slate-500">{label}</Text>
          <Text className="text-base font-semibold text-slate-900" numberOfLines={2}>
            {value}
          </Text>
        </View>

        {resolved ? (
          <Pressable onPress={onReject} accessibilityRole="button" className="px-3 py-2">
            <Text className="text-sm font-medium text-slate-500">Change</Text>
          </Pressable>
        ) : (
          <View className="flex-row">
            <Pressable
              onPress={onReject}
              accessibilityRole="button"
              accessibilityLabel={`Reject ${label}`}
              className="w-11 h-11 rounded-full bg-slate-100 border border-slate-300 items-center justify-center mr-2"
            >
              <Text className="text-lg text-slate-700">✕</Text>
            </Pressable>
            <Pressable
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel={`Accept ${label}`}
              className="w-11 h-11 rounded-full bg-emerald-600 items-center justify-center"
            >
              <Text className="text-lg text-white">✓</Text>
            </Pressable>
          </View>
        )}
      </View>

      {editing ? <View className="px-4 pb-2 border-t border-slate-200 pt-3">{children}</View> : null}
    </View>
  );
}

/**
 * Presents what was heard for confirmation, one attribute at a time.
 *
 * Only fields the model actually returned appear: an attribute it did not hear
 * has nothing to accept, so showing a card for it would be asking the user to
 * dismiss an empty question. Those keep their defaults and stay editable on
 * Item Details.
 */
export function ProposalReview({
  proposal,
  values,
  onChange,
}: {
  proposal: ItemProposal;
  values: ReviewedValues;
  onChange: (patch: Partial<ReviewedValues>) => void;
}) {
  const [resolved, setResolved] = useState<ReadonlySet<ReviewableField>>(new Set());
  const [editing, setEditing] = useState<ReviewableField | null>(null);
  const [costText, setCostText] = useState('');

  const proposedFields = useMemo(() => {
    const fields: ReviewableField[] = [];
    if (proposal.brand !== undefined) fields.push('brand');
    if (proposal.costMinorUnits !== undefined) fields.push('cost');
    if (proposal.primaryColor !== undefined) fields.push('colors');
    if (proposal.category !== undefined) fields.push('category');
    if (proposal.isSecondHand !== undefined) fields.push('isSecondHand');
    if (proposal.materials !== undefined) fields.push('materials');
    return fields;
  }, [proposal]);

  if (proposedFields.length === 0) {
    return (
      <Text className="text-sm text-slate-500 mb-4">
        Nothing was picked out of that description. You can add the details later.
      </Text>
    );
  }

  const resolve = (field: ReviewableField, patch: Partial<ReviewedValues>) => {
    onChange(patch);
    setResolved(new Set(resolved).add(field));
    setEditing(null);
  };

  const startEditing = (field: ReviewableField) => {
    if (field === 'cost') setCostText((values.costMinorUnits / 100).toFixed(2));
    setEditing(editing === field ? null : field);
  };

  const selectedColors = [values.primaryColor, values.secondaryColor].filter(
    (color): color is ItemColor => color !== '',
  );

  const card = (
    field: ReviewableField,
    label: string,
    value: string,
    accept: Partial<ReviewedValues>,
    editor: React.ReactNode,
  ) =>
    proposedFields.includes(field) ? (
      <ProposalCard
        key={field}
        label={label}
        value={value}
        resolved={resolved.has(field)}
        editing={editing === field}
        onAccept={() => resolve(field, accept)}
        onReject={() => startEditing(field)}
      >
        {editor}
      </ProposalCard>
    ) : null;

  return (
    <View>
      {card(
        'brand',
        'Brand',
        values.brand,
        { brand: values.brand },
        <TextInput
          value={values.brand === 'Unknown' ? '' : values.brand}
          onChangeText={(text) => onChange({ brand: text })}
          placeholder="Type the brand"
          placeholderTextColor="#94a3b8"
          autoFocus
          className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900 mb-3"
          onSubmitEditing={() => resolve('brand', { brand: values.brand.trim() || 'Unknown' })}
        />,
      )}

      {card(
        'cost',
        'Cost',
        formatCost(values.costMinorUnits),
        { costMinorUnits: values.costMinorUnits },
        <View className="mb-3">
          <TextInput
            value={costText}
            onChangeText={(text) => {
              setCostText(text);
              const parsed = parseCost(text);
              if (parsed !== null) onChange({ costMinorUnits: parsed });
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#94a3b8"
            autoFocus
            className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900"
          />
        </View>,
      )}

      {card(
        'colors',
        'Colour',
        selectedColors.join(' / ') || 'None',
        { primaryColor: values.primaryColor, secondaryColor: values.secondaryColor },
        <MultiSelectField
          label="Colours (up to 2)"
          options={ALL_COLORS}
          selected={selectedColors}
          onChange={(next) => onChange(toColorPair(next as ItemColor[]))}
          emptyLabel="Select colours"
        />,
      )}

      {card(
        'category',
        'Category',
        values.category,
        { category: values.category },
        <OptionRow
          label="Category"
          options={ALL_CATEGORIES}
          value={values.category}
          onChange={(category) => resolve('category', { category })}
        />,
      )}

      {card(
        'isSecondHand',
        'Second-hand',
        values.isSecondHand ? 'Yes' : 'No',
        { isSecondHand: values.isSecondHand },
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-sm text-slate-700">Bought second-hand</Text>
          <Switch
            value={values.isSecondHand}
            onValueChange={(isSecondHand) => onChange({ isSecondHand })}
          />
        </View>,
      )}

      {card(
        'materials',
        'Materials',
        values.materials.join(', ') || 'None',
        { materials: values.materials },
        <MultiSelectField
          label="Materials"
          options={ALL_MATERIALS}
          selected={values.materials}
          onChange={(materials) => onChange({ materials })}
          emptyLabel="Select materials"
        />,
      )}
    </View>
  );
}
