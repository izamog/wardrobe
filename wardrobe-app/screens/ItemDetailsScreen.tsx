import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { usePhotoCapture } from '../components/PhotoPicker';
import {
  MultiSelectField,
  OptionRow,
  PrimaryButton,
  SwitchField,
  TextField,
} from '../components/Form';
import { useDbQuery } from '../hooks/useDbQuery';
import { getItem, updateItem, type ItemUpdate } from '../services/items';
import { removeItem, replaceItemImage } from '../services/itemActions';
import { withDb } from '../services/database';
import { ALL_CATEGORIES } from '../utils/categories';
import { ALL_MATERIALS } from '../utils/materials';
import { costPerWear, formatCost, parseCost } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';
import type { Category, ClothingItem, HardwareColor } from '../types/wardrobe';

const HARDWARE_COLORS: readonly HardwareColor[] = ['None', 'Gold', 'Silver'];

/**
 * Hardware colour is only worth recording where it drives a decision.
 *
 * Phase 4 matches a belt's hardware against a bag's; nothing consults the
 * finish on a t-shirt. Asking for it everywhere is a question with no
 * consequence attached.
 */
const hardwareColorApplies = (category: Category) => category === 'Belt' || category === 'Bag';

/** Only bottoms have belt loops, and only bottoms decide whether a belt is wearable. */
const beltLoopsApply = (category: Category) => category === 'Bottom';

/**
 * The edit form's own state.
 *
 * inferredWarmth and inferredWind are absent deliberately: they are model
 * inputs the app derives (Phase 3 fills them from the voice description), not
 * numbers a person should be asked to guess. They stay on the row and are left
 * untouched by an edit here.
 */
interface Draft {
  category: Category;
  brand: string;
  cost: string;
  isSecondHand: boolean;
  materials: string[];
  hardwareColor: HardwareColor;
  hasBeltLoops: boolean;
}

function toDraft(item: ClothingItem): Draft {
  return {
    category: item.category,
    brand: item.brand,
    cost: (item.costMinorUnits / 100).toFixed(2),
    isSecondHand: item.isSecondHand,
    materials: item.materials,
    hardwareColor: item.hardwareColor,
    hasBeltLoops: item.hasBeltLoops,
  };
}

export function ItemDetailsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { itemId } = useRoute<RouteProp<RootStackParamList, 'ItemDetails'>>().params;

  const { data: item, error, loading, reload } = useDbQuery((db) => getItem(db, itemId), [itemId]);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Seeding on every load rather than only when draft is null keeps the form in
  // step with the row after a save; the screen reloads on focus, so a stale
  // draft would otherwise survive edits made elsewhere.
  useEffect(() => {
    if (item) setDraft(toDraft(item));
  }, [item]);

  // Declared before the early returns below, because hooks cannot be called
  // conditionally. It no-ops until the item has loaded.
  const onPhotoPicked = useCallback(
    (uri: string) => {
      void (async () => {
        if (!item) return;
        try {
          await replaceItemImage(item, uri);
          await reload();
        } catch (e) {
          console.error('Failed to replace photo:', e);
          Alert.alert('Could not save the photo', 'The item still has its old picture.');
        }
      })();
    },
    [item, reload],
  );
  const { capture, busy: capturing } = usePhotoCapture(onPhotoPicked);

  const choosePhoto = useCallback(() => {
    Alert.alert('Item photo', undefined, [
      { text: 'Take a photo', onPress: () => void capture('camera') },
      { text: 'Choose from library', onPress: () => void capture('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [capture]);

  if (error) return <EmptyState title={error} />;
  if (loading && !item) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator />
      </View>
    );
  }
  if (!item || !draft) return <EmptyState title="This item no longer exists." />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function save() {
    if (!draft) return;
    const costMinorUnits = parseCost(draft.cost);
    if (costMinorUnits === null) {
      Alert.alert('Check the cost', 'Enter a number like 24.99, or leave it blank.');
      return;
    }

    const update: ItemUpdate = {
      category: draft.category,
      brand: draft.brand.trim() || 'Unknown',
      costMinorUnits,
      isSecondHand: draft.isSecondHand,
      materials: draft.materials,
      // Both of these are only askable for some categories. Clearing them for
      // the rest means recategorising a garment cannot leave an invisible
      // value behind -- Phase 4's belt rules read hasBeltLoops, and would
      // otherwise act on a flag set while the item was still a Bottom.
      hardwareColor: hardwareColorApplies(draft.category) ? draft.hardwareColor : 'None',
      hasBeltLoops: beltLoopsApply(draft.category) ? draft.hasBeltLoops : false,
    };

    try {
      await withDb((db) => updateItem(db, itemId, update));
      navigation.goBack();
    } catch (e) {
      console.error('Failed to update item:', e);
      Alert.alert('Could not save', 'Your changes were not stored.');
    }
  }

  function confirmDelete() {
    Alert.alert('Delete this item?', 'Its match and dismatch records go with it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!item) return;
            try {
              // Removes the row, its photos and, through the foreign key, its
              // match and dismatch records.
              await removeItem(item);
              navigation.goBack();
            } catch (e) {
              console.error('Failed to delete item:', e);
              Alert.alert('Could not delete', 'The item is still there.');
            }
          })();
        },
      },
    ]);
  }

  const perWear = costPerWear(item.costMinorUnits, item.wearCount);

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="pb-10">
      {/* Deliberately not pressable: the photo fills most of the screen, so
          tapping it by accident used to launch the picker and lose the user's
          place. Replacing a photo goes through the button below and nothing
          else. */}
      <View className="aspect-square bg-slate-200 items-center justify-center">
        {capturing ? (
          <ActivityIndicator />
        ) : (
          <StoredImage
            path={item.imagePath}
            placeholder="No photo"
            placeholderClassName="text-slate-500"
          />
        )}
      </View>

      <View className="px-4 pt-3 bg-white">
        <PrimaryButton
          label={capturing ? 'Working…' : 'Replace image'}
          tone="secondary"
          onPress={choosePhoto}
          disabled={capturing}
        />
      </View>

      <View className="flex-row justify-between px-4 py-3 bg-white border-b border-slate-200">
        <View>
          <Text className="text-xs uppercase tracking-wide text-slate-500">Worn</Text>
          <Text className="text-base font-semibold text-slate-900">
            {item.wearCount === 0 ? 'Not yet worn' : `${item.wearCount}×`}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-xs uppercase tracking-wide text-slate-500">Cost per wear</Text>
          <Text className="text-base font-semibold text-slate-900">
            {perWear ?? `${formatCost(item.costMinorUnits)} so far`}
          </Text>
        </View>
      </View>

      <View className="p-4">
        <OptionRow
          label="Category"
          options={ALL_CATEGORIES}
          value={draft.category}
          onChange={(v) => set('category', v)}
        />
        <TextField
          label="Brand or name"
          value={draft.brand}
          onChangeText={(v) => set('brand', v)}
        />
        <TextField
          label="Cost (£)"
          value={draft.cost}
          onChangeText={(v) => set('cost', v)}
          keyboardType="decimal-pad"
        />
        <MultiSelectField
          label="Materials"
          options={ALL_MATERIALS}
          selected={draft.materials}
          onChange={(v) => set('materials', v)}
          emptyLabel="Select materials"
        />
        {hardwareColorApplies(draft.category) && (
          <OptionRow
            label="Hardware colour"
            options={HARDWARE_COLORS}
            value={draft.hardwareColor}
            onChange={(v) => set('hardwareColor', v)}
          />
        )}
        <SwitchField
          label="Bought second-hand"
          value={draft.isSecondHand}
          onValueChange={(v) => set('isSecondHand', v)}
        />
        {beltLoopsApply(draft.category) && (
          <SwitchField
            label="Has belt loops"
            value={draft.hasBeltLoops}
            onValueChange={(v) => set('hasBeltLoops', v)}
          />
        )}

        <View className="mt-2">
          <PrimaryButton label="Save changes" onPress={save} />
        </View>
        <View className="mt-3">
          <PrimaryButton
            label="Matches"
            onPress={() => navigation.navigate('MatchesBrowser', { itemId })}
          />
        </View>
        <View className="mt-3">
          <PrimaryButton label="Delete item" tone="danger" onPress={confirmDelete} />
        </View>
      </View>
    </ScrollView>
  );
}
