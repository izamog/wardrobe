import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { usePhotoCapture } from '../components/PhotoPicker';
import {
  OptionRow,
  PrimaryButton,
  ScaleField,
  SwitchField,
  TextField,
} from '../components/Form';
import { useDbQuery } from '../hooks/useDbQuery';
import { getItem, updateItem, type ItemUpdate } from '../services/items';
import { removeItem, replaceItemImage } from '../services/itemActions';
import { withDb } from '../services/database';
import { ALL_CATEGORIES } from '../utils/categories';
import { getLayersOver, getLayersUnder } from '../utils/layering';
import { costPerWear, formatCost, parseCost } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';
import type { Category, ClothingItem, HardwareColor } from '../types/wardrobe';

const HARDWARE_COLORS: readonly HardwareColor[] = ['None', 'Gold', 'Silver'];

/** The edit form's own state — strings where the user types free text. */
interface Draft {
  category: Category;
  brand: string;
  cost: string;
  isSecondHand: boolean;
  materials: string;
  hardwareColor: HardwareColor;
  hasBeltLoops: boolean;
  inferredWarmth: number;
  inferredWind: number;
}

function toDraft(item: ClothingItem): Draft {
  return {
    category: item.category,
    brand: item.brand,
    cost: (item.costMinorUnits / 100).toFixed(2),
    isSecondHand: item.isSecondHand,
    materials: item.materials.join(', '),
    hardwareColor: item.hardwareColor,
    hasBeltLoops: item.hasBeltLoops,
    inferredWarmth: item.inferredWarmth,
    inferredWind: item.inferredWind,
  };
}

/**
 * What this garment can be worn with on the same half of the body.
 *
 * Renders nothing for garments with no layering rules — a Bottom, or one of
 * the legacy generic categories — rather than showing two empty lists.
 */
function LayeringSummary({ category }: { category: Category }) {
  const over = getLayersOver(category);
  const under = getLayersUnder(category);
  if (over.length === 0 && under.length === 0) return null;

  return (
    <View className="px-4 py-3 bg-white border-b border-slate-200">
      <Text className="text-xs uppercase tracking-wide text-slate-500 mb-1">Layering</Text>
      {over.length > 0 && (
        <Text className="text-sm text-slate-700">Goes under: {over.join(', ')}</Text>
      )}
      {under.length > 0 && (
        <Text className="text-sm text-slate-700">Goes over: {under.join(', ')}</Text>
      )}
    </View>
  );
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
      materials: draft.materials
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      hardwareColor: draft.hardwareColor,
      hasBeltLoops: draft.hasBeltLoops,
      inferredWarmth: draft.inferredWarmth,
      inferredWind: draft.inferredWind,
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
      <Pressable
        onPress={choosePhoto}
        accessibilityRole="button"
        accessibilityLabel={item.imagePath ? 'Change photo' : 'Add a photo'}
        className="aspect-square bg-slate-200 items-center justify-center"
      >
        {capturing ? (
          <ActivityIndicator />
        ) : (
          <StoredImage
            path={item.imagePath}
            placeholder="Tap to add a photo"
            placeholderClassName="text-slate-500"
          />
        )}
      </Pressable>

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

      {/* Follows the picker, not the saved row, so changing the category
          shows what that change would mean before it is saved. */}
      <LayeringSummary category={draft.category} />

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
        <TextField
          label="Materials (comma separated)"
          value={draft.materials}
          onChangeText={(v) => set('materials', v)}
          placeholder="cotton, wool"
        />
        <OptionRow
          label="Hardware colour"
          options={HARDWARE_COLORS}
          value={draft.hardwareColor}
          onChange={(v) => set('hardwareColor', v)}
        />
        <SwitchField
          label="Bought second-hand"
          value={draft.isSecondHand}
          onValueChange={(v) => set('isSecondHand', v)}
        />
        <SwitchField
          label="Has belt loops"
          value={draft.hasBeltLoops}
          onValueChange={(v) => set('hasBeltLoops', v)}
        />
        <ScaleField
          label="Warmth (0-10)"
          value={draft.inferredWarmth}
          onChange={(v) => set('inferredWarmth', v)}
        />
        <ScaleField
          label="Wind resistance (0-10)"
          value={draft.inferredWind}
          onChange={(v) => set('inferredWind', v)}
        />

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
