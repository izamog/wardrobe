import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { ItemPhotoBackdrop } from '../components/ItemPhotoBackdrop';
import { usePhotoCapture } from '../components/PhotoPicker';
import {
  MonthYearField,
  MultiSelectField,
  OptionRow,
  PrimaryButton,
  SwitchField,
  TextField,
} from '../components/Form';
import { useDbQuery } from '../hooks/useDbQuery';
import { archiveItems, getItem, updateItem, type ItemUpdate } from '../services/items';
import { replaceItemImage } from '../services/itemActions';
import { withDb } from '../services/database';
import {
  ALL_CATEGORIES,
  backlessApplies,
  beltLoopsApply,
  denierApplies,
  hardwareColorApplies,
  lengthApplies,
  lengthOptionsFor,
  materialPercentApplies,
  sleeveLengthApplies,
  thicknessApplies,
} from '../utils/categories';
import { ALL_MATERIALS, materialPercentsFrom, reconcileMaterials } from '../utils/materials';
import { ALL_COLORS, toColorPair } from '../utils/colors';
import {
  costPerWear,
  formatCost,
  formatPurchasedAtMonth,
  parseCost,
  parseDenier,
  parsePurchasedAtMonth,
  parseScale,
  SCALE_MAX,
} from '../utils/format';
import { estimateWarmth, estimateWind } from '../utils/warmth';
import type { RootStackParamList } from '../navigation/types';
import type {
  Category,
  ClothingItem,
  GarmentLength,
  HardwareColor,
  ItemColor,
  MaterialEntry,
  SleeveLength,
  Thickness,
} from '../types/wardrobe';

const SLEEVE_LENGTHS: readonly SleeveLength[] = ['Sleeveless', 'Short', 'Long'];
const THICKNESSES: readonly Thickness[] = ['Mesh', 'Light', 'Regular', 'Thick', 'Heavy'];
const DENIER_MIN = 5;
const DENIER_MAX = 270;

const HARDWARE_COLORS: readonly HardwareColor[] = ['None', 'Gold', 'Silver', 'Brass', 'Black'];

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
  isWorkAppropriate: boolean;
  /** Held as a list because that is what the picker speaks; split into the two columns on save. */
  colors: ItemColor[];
  materials: MaterialEntry[];
  purchasedAt: string;
  hardwareColor: HardwareColor;
  hasBeltLoops: boolean;
  sleeveLength: SleeveLength;
  length: GarmentLength | '';
  thickness: Thickness;
  /** Held as a string, same reasoning as inferredWarmth/inferredWind below — see denier's own field in EditForm. */
  denier: string;
  backless: boolean;
  inferredWarmth: string;
  inferredWind: string;
}

function toDraft(item: ClothingItem): Draft {
  return {
    category: item.category,
    brand: item.brand,
    cost: (item.costMinorUnits / 100).toFixed(2),
    isSecondHand: item.isSecondHand,
    isWorkAppropriate: item.isWorkAppropriate,
    colors: [item.primaryColor, item.secondaryColor].filter(
      (color): color is ItemColor => color !== '',
    ),
    materials: item.materials,
    purchasedAt: item.purchasedAt,
    hardwareColor: item.hardwareColor,
    hasBeltLoops: item.hasBeltLoops,
    sleeveLength: item.sleeveLength,
    length: item.length,
    thickness: item.thickness,
    denier: item.denier === 0 ? '' : String(item.denier),
    backless: item.backless,
    inferredWarmth: String(item.inferredWarmth),
    inferredWind: String(item.inferredWind),
  };
}

/** One attribute in the read-only view. */
function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between items-start py-3 border-b border-rule">
      <Text className="text-sm font-sans text-ink-muted mr-4">{label}</Text>
      <Text className="text-sm font-sans-medium text-ink flex-1 text-right">{value || '—'}</Text>
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

  const purchasedAt = parsePurchasedAtMonth(draft.purchasedAt);
  if (purchasedAt === null) {
    return {
      errorTitle: 'Check when bought',
      error: 'Pick a month in the past, or leave it blank.',
    };
  }

  const denier = parseDenier(draft.denier);
  if (denier === null) {
    return {
      errorTitle: 'Check denier',
      error: 'A whole number from 5 to 270, or leave it blank.',
    };
  }

  return {
    category: draft.category,
    brand: draft.brand.trim() || 'Unknown',
    costMinorUnits,
    isSecondHand: draft.isSecondHand,
    isWorkAppropriate: draft.isWorkAppropriate,
    materials: materialPercentApplies(draft.category)
      ? draft.materials
      : draft.materials.map((m) => ({ ...m, percent: 0 })),
    purchasedAt,
    // toColorPair applies the same rules as the CHECK constraints, so the
    // form cannot submit a pair SQLite would reject.
    ...toColorPair(draft.colors),
    // These four are each only askable for some categories. Clearing them
    // for the rest means recategorising a garment cannot leave an invisible
    // value behind -- Phase 4's belt rules read hasBeltLoops, and would
    // otherwise act on a flag set while the item was still Pants; the same
    // applies to sleeveLength feeding utils/warmth.ts. length has no shared
    // neutral value the way sleeveLength does, so it clears to '' rather than
    // a guessed default -- see the GarmentLength doc comment.
    hardwareColor: hardwareColorApplies(draft.category) ? draft.hardwareColor : 'None',
    hasBeltLoops: beltLoopsApply(draft.category) ? draft.hasBeltLoops : false,
    sleeveLength: sleeveLengthApplies(draft.category) ? draft.sleeveLength : 'Short',
    length: lengthApplies(draft.category) ? draft.length : '',
    thickness: thicknessApplies(draft.category) ? draft.thickness : 'Regular',
    denier: denierApplies(draft.category) ? denier : 0,
    backless: backlessApplies(draft.category) ? draft.backless : false,
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
      {/* Category is inferred rather than chosen, so a wrong one has to be
          fixable — now visible in the read view too (see ReadOnlyDetails). */}
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
        label="Materials (up to 2)"
        options={ALL_MATERIALS}
        selected={draft.materials.map((m) => m.material)}
        onChange={(names) => set('materials', reconcileMaterials(draft.materials, names))}
        emptyLabel="Select materials"
        maxSelected={2}
      />
      {materialPercentApplies(draft.category) &&
        draft.materials.map((entry) => (
          <View key={entry.material} className="flex-row items-center justify-between mb-3">
            <Text className="text-sm font-sans text-ink-muted">{entry.material} %</Text>
            <View className="bg-paper border border-rule rounded-sm h-11 px-3 justify-center w-20">
              <TextInput
                value={entry.percent === 0 ? '' : String(entry.percent)}
                onChangeText={(text) => {
                  const parsed = Number(text);
                  const percent =
                    text.trim() === '' || !Number.isInteger(parsed) ? 0 : Math.min(100, Math.max(0, parsed));
                  set(
                    'materials',
                    draft.materials.map((m) => (m.material === entry.material ? { ...m, percent } : m)),
                  );
                }}
                keyboardType="number-pad"
                placeholder="0-100"
                placeholderTextColor="#6B6259"
                style={{ lineHeight: 18 }}
                className="p-0 text-base font-sans-medium text-ink text-right"
              />
            </View>
          </View>
        ))}
      {materialPercentApplies(draft.category) && draft.materials.length > 0 && (
        <Text className="text-xs font-sans text-ink-muted -mt-2 mb-3">
          Doesn&apos;t need to add up to 100% — leave a material blank if you don&apos;t know its share.
        </Text>
      )}
      <MonthYearField label="Bought" value={draft.purchasedAt} onChange={(v) => set('purchasedAt', v)} />
      {hardwareColorApplies(draft.category) && (
        <OptionRow
          label="Hardware colour"
          options={HARDWARE_COLORS}
          value={draft.hardwareColor}
          onChange={(v) => set('hardwareColor', v)}
        />
      )}
      {sleeveLengthApplies(draft.category) && (
        <OptionRow
          label="Sleeves"
          options={SLEEVE_LENGTHS}
          value={draft.sleeveLength}
          onChange={(v) => set('sleeveLength', v)}
        />
      )}
      {lengthApplies(draft.category) && (
        <OptionRow
          label="Length"
          options={lengthOptionsFor(draft.category)}
          value={draft.length}
          onChange={(v) => set('length', v)}
        />
      )}
      {thicknessApplies(draft.category) && (
        <OptionRow
          label="Thickness"
          options={THICKNESSES}
          value={draft.thickness}
          onChange={(v) => set('thickness', v)}
        />
      )}
      {denierApplies(draft.category) && (
        <TextField
          label={`Denier (${DENIER_MIN}-${DENIER_MAX})`}
          value={draft.denier}
          onChangeText={(v) => set('denier', v)}
          keyboardType="number-pad"
        />
      )}
      <SwitchField
        label="Bought second-hand"
        value={draft.isSecondHand}
        onValueChange={(v) => set('isSecondHand', v)}
      />
      <SwitchField
        label="Work appropriate"
        value={draft.isWorkAppropriate}
        onValueChange={(v) => set('isWorkAppropriate', v)}
      />
      {beltLoopsApply(draft.category) && (
        <SwitchField
          label="Has belt loops"
          value={draft.hasBeltLoops}
          onValueChange={(v) => set('hasBeltLoops', v)}
        />
      )}
      {backlessApplies(draft.category) && (
        <SwitchField
          label="Backless"
          value={draft.backless}
          onValueChange={(v) => set('backless', v)}
        />
      )}
    </>
  );
}

function ReadOnlyDetails({ item }: { item: ClothingItem }) {
  return (
    <View className="mb-4">
      {/* Shown here, unlike before: with no confirmation anywhere on this
          screen, a saved category change was indistinguishable from one that
          silently failed to save. */}
      <ReadRow label="Category" value={item.category} />
      <ReadRow label="Brand" value={item.brand === 'Unknown' ? '' : item.brand} />
      <ReadRow label="Cost" value={formatCost(item.costMinorUnits)} />
      <ReadRow
        label="Colour"
        value={[item.primaryColor, item.secondaryColor].filter(Boolean).join(' / ')}
      />
      <ReadRow
        label="Materials"
        value={item.materials
          .map((m) => (m.percent > 0 ? `${m.material} (${m.percent}%)` : m.material))
          .join(', ')}
      />
      <ReadRow label="Bought" value={formatPurchasedAtMonth(item.purchasedAt)} />
      {hardwareColorApplies(item.category) && <ReadRow label="Hardware" value={item.hardwareColor} />}
      {sleeveLengthApplies(item.category) && (
        <ReadRow label="Sleeves" value={item.sleeveLength} />
      )}
      {lengthApplies(item.category) && <ReadRow label="Length" value={item.length} />}
      {thicknessApplies(item.category) && <ReadRow label="Thickness" value={item.thickness} />}
      {denierApplies(item.category) && (
        <ReadRow label="Denier" value={item.denier === 0 ? '' : String(item.denier)} />
      )}
      <ReadRow label="Second-hand" value={item.isSecondHand ? 'Yes' : 'No'} />
      <ReadRow label="Work appropriate" value={item.isWorkAppropriate ? 'Yes' : 'No'} />
      {beltLoopsApply(item.category) && (
        <ReadRow label="Belt loops" value={item.hasBeltLoops ? 'Yes' : 'No'} />
      )}
      {backlessApplies(item.category) && (
        <ReadRow label="Backless" value={item.backless ? 'Yes' : 'No'} />
      )}
    </View>
  );
}

/** Photo header: the stored image plus, while editing, the buttons to replace it or open Image adjustments. */
function PhotoHeader({
  item,
  editing,
  capturing,
  choosePhoto,
  onAdjustImage,
  windowHeight,
}: {
  item: ClothingItem;
  editing: boolean;
  capturing: boolean;
  choosePhoto: () => void;
  onAdjustImage: () => void;
  windowHeight: number;
}) {
  return (
    <>
      {/* Deliberately not pressable: the photo fills most of the screen, so
          tapping it by accident used to launch the picker and lose the user's
          place. Replacing or adjusting a photo goes through the buttons
          below and nothing else. */}
      {/* Capped at a third of the screen. At 3:4 full width the photo was most
          of a phone screen, so the attributes the user opened the item to read
          began below the fold. */}
      <View
        className="items-center justify-center border-b border-rule overflow-hidden"
        style={{ height: windowHeight / 3 }}
      >
        <ItemPhotoBackdrop />
        {capturing ? (
          <ActivityIndicator />
        ) : (
          <StoredImage
            path={item.imagePath}
            hasBakedMargin={item.imageMarginBaked}
            placeholder="No photo"
            placeholderClassName="text-ink-muted font-sans"
          />
        )}
      </View>

      {editing ? (
        <View className="px-5 pt-3 bg-white">
          <PrimaryButton
            label={capturing ? 'Working…' : 'Replace image'}
            tone="secondary"
            onPress={choosePhoto}
            disabled={capturing}
          />
          <View className="mt-2">
            <PrimaryButton
              label="Image adjustments"
              tone="secondary"
              onPress={onAdjustImage}
              disabled={capturing}
            />
          </View>
        </View>
      ) : null}
    </>
  );
}

/** Wear count on the left, cost-per-wear (or running cost) on the right. */
function WearStatsRow({ item }: { item: ClothingItem }) {
  const perWear = costPerWear(item.costMinorUnits, item.wearCount);
  return (
    <View className="flex-row justify-between px-4 py-3 bg-paper border-b border-rule">
      <View>
        <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted">Worn</Text>
        {/* Big statistics numbers: Public Sans 300 — text-base isn't "large" (see design.md's size threshold), so no bump to 400. */}
        <Text className="text-base font-sans-light text-ink">
          {item.wearCount === 0 ? 'Not yet worn' : `${item.wearCount}×`}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-xs font-sans uppercase tracking-wide text-ink-muted">Cost per wear</Text>
        <Text className="text-base font-sans-light text-ink">
          {perWear ?? `${formatCost(item.costMinorUnits)} so far`}
        </Text>
      </View>
    </View>
  );
}

/** The warmth/windproof estimate fields — always editable, regardless of edit mode. */
function EstimatesEditor({
  draft,
  set,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const resetToEstimate = () => {
    const materialNames = draft.materials.map((m) => m.material);
    set(
      'inferredWarmth',
      String(
        estimateWarmth(
          draft.category,
          materialNames,
          draft.sleeveLength,
          draft.length,
          draft.thickness,
          parseDenier(draft.denier) ?? 0,
          materialPercentsFrom(draft.materials),
          draft.backless,
        ),
      ),
    );
    set(
      'inferredWind',
      String(
        estimateWind(draft.category, materialNames, draft.sleeveLength, draft.length, draft.backless),
      ),
    );
  };

  return (
    <View className="mt-2 mb-4 p-3 rounded-sm bg-paper-2">
      <Text className="text-xs font-sans text-ink-muted mb-3">
        Generated from category and materials when an item is added. Editable here so a wrong
        value — including a stale one from before the estimate changed — can be corrected.
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
      {/* Fills the two fields above from the current category and materials;
          does not save on its own. Save still applies (or Cancel discards)
          the result, same as typing a value by hand. */}
      <Pressable
        onPress={resetToEstimate}
        accessibilityRole="button"
        className="mt-3 self-start rounded-sm border border-rule bg-paper px-3 py-2"
      >
        <Text className="text-sm font-sans-medium text-ink-muted">↻ Reset to estimate</Text>
      </Pressable>
    </View>
  );
}

/** Save (while editing), Matches and Delete — the screen's bottom actions. */
function ActionButtons({
  itemId,
  editing,
  onSave,
  onDelete,
  navigateToMatches,
  navigateToOutfits,
}: {
  itemId: string;
  editing: boolean;
  onSave: () => void;
  onDelete: () => void;
  navigateToMatches: (itemId: string) => void;
  navigateToOutfits: (itemId: string) => void;
}) {
  return (
    <>
      {editing ? (
        <View className="mt-2">
          <PrimaryButton label="Save changes" onPress={onSave} />
        </View>
      ) : null}
      <View className="mt-3">
        <PrimaryButton label="Matches" onPress={() => navigateToMatches(itemId)} />
      </View>
      <View className="mt-3">
        <PrimaryButton label="Create outfit with item" tone="secondary" onPress={() => navigateToOutfits(itemId)} />
      </View>
      <View className="mt-3">
        <PrimaryButton label="Delete item" tone="danger" onPress={onDelete} />
      </View>
    </>
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
          await replaceItemImage({ runQuery: withDb }, item, { original: image.uri });
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

  // A useCallback, not a plain function declared after the early returns
  // below: the header's "Done" button is registered through
  // navigation.setOptions in the layout effect that follows, and that
  // registration only re-runs when its own dependency array changes. A
  // plain closure referenced there would keep calling whatever `draft` was
  // current the *last* time editing was toggled, not the latest one — this
  // Save being memoized on [draft, itemId, navigation] is what keeps the
  // header button (and the bottom "Save changes" button) both calling the
  // version that actually has the user's edits.
  const save = useCallback(async () => {
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
  }, [draft, itemId, navigation]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          // "Done" saves — it does not merely close the edit form. It used
          // to just flip `editing` back to false, which left the draft's
          // edits sitting unsaved in memory while the screen switched back
          // to ReadOnlyDetails (which renders the untouched `item`, not the
          // draft) — indistinguishable from the edit having been silently
          // discarded. Entering edit mode is still a separate, cheap toggle;
          // leaving it now goes through the same save() the bottom button
          // uses, so there is one way to persist a change, not two
          // half-implemented ones.
          onPress={() => (editing ? void save() : setEditing(true))}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Save changes' : 'Edit item'}
          hitSlop={12}
          className="px-2 py-1"
        >
          {editing ? (
            <Text className="text-base font-sans-medium text-ink">Done</Text>
          ) : (
            <Ionicons name="create-outline" size={22} color="#1A1714" />
          )}
        </Pressable>
      ),
    });
  }, [navigation, editing, save]);

  if (error) return <EmptyState title={error} />;
  if (loading && !item) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }
  if (!item || !draft) return <EmptyState title="This item no longer exists." />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  // EstimatesEditor is shown even outside `editing` (see its own doc comment),
  // but ActionButtons' "Save changes" -- and the header's Done-saves button --
  // only appear once `editing` is true. Without this, resetting or typing a
  // new warmth/wind value from the read-only view updated `draft` with no way
  // to persist it: the value showed correctly on screen but was silently
  // discarded the moment the screen was left, then reappeared unchanged next
  // visit. Routing its edits through `set` too keeps every write going
  // through the same single setter, just also opening the session that can
  // actually save it.
  const setAndEdit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setEditing(true);
    set(key, value);
  };

  // Archives rather than hard-deletes -- same as ClosetScreen's bulk delete
  // (see confirmAndArchive there), so there is exactly one way to delete an
  // item and it always goes through the 30-day Archive/restore window, not
  // two behaviours depending on which screen you delete from.
  function confirmDelete() {
    Alert.alert('Delete this item?', 'Deleted items are held for 30 days before being removed for good — you can restore them from Archive until then.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!item) return;
            try {
              await withDb((db) => archiveItems(db, [item.id]));
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

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="pb-10">
      <PhotoHeader
        item={item}
        editing={editing}
        capturing={capturing}
        choosePhoto={choosePhoto}
        onAdjustImage={() => navigation.navigate('ImageAdjustments', { itemId })}
        windowHeight={windowHeight}
      />
      <WearStatsRow item={item} />

      <View className="p-5">
        {editing ? <EditForm draft={draft} set={set} /> : <ReadOnlyDetails item={item} />}
        <EstimatesEditor draft={draft} set={setAndEdit} />
        <ActionButtons
          itemId={itemId}
          editing={editing}
          // Not `setEditing(false)` here: save() already navigates back on
          // success, so closing edit mode from here too was a race — on a
          // validation failure specifically, save() returns early (after
          // showing its own Alert) *without* navigating, and this used to
          // still flip the screen to read-only under that Alert regardless,
          // silently dropping back to a view that doesn't even show category
          // (see ReadOnlyDetails) with no visible sign anything was wrong.
          onSave={() => void save()}
          onDelete={confirmDelete}
          navigateToMatches={(id) => navigation.navigate('MatchesBrowser', { itemId: id })}
          navigateToOutfits={(id) => navigation.navigate('ItemOutfits', { itemId: id })}
        />
      </View>
    </ScrollView>
  );
}
