import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { ALL_CATEGORIES, beltLoopsApply, hardwareColorApplies } from '../utils/categories';
import { ALL_MATERIALS } from '../utils/materials';
import { ALL_COLORS, toColorPair } from '../utils/colors';
import { costPerWear, formatCost, parseCost, parseScale, SCALE_MAX } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';
import type { Category, ClothingItem, HardwareColor, ItemColor } from '../types/wardrobe';

const HARDWARE_COLORS: readonly HardwareColor[] = ['None', 'Gold', 'Silver'];

/**
 * The edit form's own state, strings wherever the user types.
 *
 * Warmth and windproof are here as plain numbers rather than pickers: they are
 * values the app will generate from Phase 3 onwards, and the fields exist so
 * a wrong one can be seen and corrected while that is being built. They are
 * not a question the user is expected to answer when adding a garment.
 */
interface Draft {
  category: Category;
  brand: string;
  cost: string;
  isSecondHand: boolean;
  /** Held as a list because that is what the picker speaks; split into the two columns on save. */
  colors: ItemColor[];
  materials: string[];
  hardwareColor: HardwareColor;
  hasBeltLoops: boolean;
  inferredWarmth: string;
  inferredWind: string;
}

function toDraft(item: ClothingItem): Draft {
  return {
    category: item.category,
    brand: item.brand,
    cost: (item.costMinorUnits / 100).toFixed(2),
    isSecondHand: item.isSecondHand,
    colors: [item.primaryColor, item.secondaryColor].filter(
      (color): color is ItemColor => color !== '',
    ),
    materials: item.materials,
    hardwareColor: item.hardwareColor,
    hasBeltLoops: item.hasBeltLoops,
    inferredWarmth: String(item.inferredWarmth),
    inferredWind: String(item.inferredWind),
  };
}

/** One attribute in the read-only view. */
function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between items-start py-3 border-b border-slate-100">
      <Text className="text-sm text-slate-500 mr-4">{label}</Text>
      <Text className="text-sm font-medium text-slate-900 flex-1 text-right">{value || '—'}</Text>
    </View>
  );
}

/**
 * Turns the edit draft into the update `updateItem` expects, applying the
 * same category-conditional clearing the save button always did.
 */
function buildItemUpdate(draft: Draft): ItemUpdate | { errorTitle: string; error: string } {
  const costMinorUnits = parseCost(draft.cost);
  if (costMinorUnits === null) {
    return { errorTitle: 'Check the cost', error: 'Enter a number like 24.99, or leave it blank.' };
  }

  const inferredWarmth = parseScale(draft.inferredWarmth);
  const inferredWind = parseScale(draft.inferredWind);
  if (inferredWarmth === null || inferredWind === null) {
    return {
      errorTitle: 'Check warmth and windproof',
      error: `Whole numbers from 0 to ${SCALE_MAX}, or leave blank for not set.`,
    };
  }

  return {
    category: draft.category,
    brand: draft.brand.trim() || 'Unknown',
    costMinorUnits,
    isSecondHand: draft.isSecondHand,
    materials: draft.materials,
    // toColorPair applies the same rules as the CHECK constraints, so the
    // form cannot submit a pair SQLite would reject.
    ...toColorPair(draft.colors),
    // Both of these are only askable for some categories. Clearing them for
    // the rest means recategorising a garment cannot leave an invisible
    // value behind -- Phase 4's belt rules read hasBeltLoops, and would
    // otherwise act on a flag set while the item was still a Bottom.
    hardwareColor: hardwareColorApplies(draft.category) ? draft.hardwareColor : 'None',
    hasBeltLoops: beltLoopsApply(draft.category) ? draft.hasBeltLoops : false,
    inferredWarmth,
    inferredWind,
  };
}

function EditForm({
  draft,
  set,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  return (
    <>
      {/* Category is hidden in the read view but kept here: it is now
          inferred rather than chosen, so a wrong one has to be fixable. */}
      <OptionRow
        label="Category"
        options={ALL_CATEGORIES}
        value={draft.category}
        onChange={(v) => set('category', v)}
      />
      <TextField label="Brand or name" value={draft.brand} onChangeText={(v) => set('brand', v)} />
      <TextField
        label="Cost (£)"
        value={draft.cost}
        onChangeText={(v) => set('cost', v)}
        keyboardType="decimal-pad"
      />
      <MultiSelectField
        label="Colours (up to 2)"
        options={ALL_COLORS}
        selected={draft.colors}
        onChange={(next) => {
          const { primaryColor, secondaryColor } = toColorPair(next as ItemColor[]);
          set(
            'colors',
            [primaryColor, secondaryColor].filter((color): color is ItemColor => color !== ''),
          );
        }}
        emptyLabel="Select colours"
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
    </>
  );
}

function ReadOnlyDetails({ item }: { item: ClothingItem }) {
  return (
    <View className="bg-white rounded-xl border border-slate-200 px-4 mb-4">
      <ReadRow label="Brand" value={item.brand === 'Unknown' ? '' : item.brand} />
      <ReadRow label="Cost" value={formatCost(item.costMinorUnits)} />
      <ReadRow
        label="Colour"
        value={[item.primaryColor, item.secondaryColor].filter(Boolean).join(' / ')}
      />
      <ReadRow label="Materials" value={item.materials.join(', ')} />
      {hardwareColorApplies(item.category) && <ReadRow label="Hardware" value={item.hardwareColor} />}
      <ReadRow label="Second-hand" value={item.isSecondHand ? 'Yes' : 'No'} />
      {beltLoopsApply(item.category) && (
        <ReadRow label="Belt loops" value={item.hasBeltLoops ? 'Yes' : 'No'} />
      )}
    </View>
  );
}

export function ItemDetailsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { itemId } = useRoute<RouteProp<RootStackParamList, 'ItemDetails'>>().params;
  const { height: windowHeight } = useWindowDimensions();

  const { data: item, error, loading, reload } = useDbQuery((db) => getItem(db, itemId), [itemId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Read-only until asked. Most visits to this screen are to look something up,
  // and a screen of live text fields invites edits nobody meant to make.
  const [editing, setEditing] = useState(false);

  // Seeding on every load rather than only when draft is null keeps the form in
  // step with the row after a save; the screen reloads on focus, so a stale
  // draft would otherwise survive edits made elsewhere.
  useEffect(() => {
    if (item) setDraft(toDraft(item));
  }, [item]);

  // Declared before the early returns below, because hooks cannot be called
  // conditionally. It no-ops until the item has loaded.
  const onPhotoPicked = useCallback(
    (image: { uri: string }) => {
      void (async () => {
        if (!item) return;
        try {
          await replaceItemImage({ runQuery: withDb }, item, image.uri);
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

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setEditing((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Stop editing' : 'Edit item'}
          className="px-2 py-1"
        >
          {editing ? (
            <Text className="text-base font-semibold text-slate-900">Done</Text>
          ) : (
            <Ionicons name="create-outline" size={22} color="#0f172a" />
          )}
        </Pressable>
      ),
    });
  }, [navigation, editing]);

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
    const update = buildItemUpdate(draft);
    if ('error' in update) {
      Alert.alert(update.errorTitle, update.error);
      return;
    }

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
              await removeItem({ runQuery: withDb }, item);
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
      {/* Capped at a third of the screen. At 3:4 full width the photo was most
          of a phone screen, so the attributes the user opened the item to read
          began below the fold. */}
      <View
        className="bg-white items-center justify-center border-b border-slate-200"
        style={{ height: windowHeight / 3 }}
      >
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

      {editing ? (
        <View className="px-4 pt-3 bg-white">
          <PrimaryButton
            label={capturing ? 'Working…' : 'Replace image'}
            tone="secondary"
            onPress={choosePhoto}
            disabled={capturing}
          />
        </View>
      ) : null}

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
        {editing ? <EditForm draft={draft} set={set} /> : <ReadOnlyDetails item={item} />}

        <View className="mt-2 mb-4 p-3 rounded-xl bg-slate-100 border border-slate-200">
          <Text className="text-xs text-slate-500 mb-3">
            Generated from Phase 3 onwards. Editable now so a wrong value can be
            corrected while that is built.
          </Text>
          <View className="flex-row">
            <View className="flex-1 mr-2">
              <TextField
                label={`Warmth (0-${SCALE_MAX})`}
                value={draft.inferredWarmth}
                onChangeText={(v) => set('inferredWarmth', v)}
                keyboardType="number-pad"
                placeholder="0"
              />
            </View>
            <View className="flex-1 ml-2">
              <TextField
                label={`Windproof (0-${SCALE_MAX})`}
                value={draft.inferredWind}
                onChangeText={(v) => set('inferredWind', v)}
                keyboardType="number-pad"
                placeholder="0"
              />
            </View>
          </View>
        </View>

        {editing ? (
          <View className="mt-2">
            <PrimaryButton
              label="Save changes"
              onPress={() => {
                void save();
                setEditing(false);
              }}
            />
          </View>
        ) : null}
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
