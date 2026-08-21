import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { StoredImage } from '../components/StoredImage';
import { RawPhotoSourceChooser } from '../components/PhotoPicker';
import { listItems, listRatedPairKeys, setCompatibility } from '../services/items';
import { withDb } from '../services/database';
import { imageUriFor, type PickedImage } from '../services/images';
import { identifyOutfitItems } from '../services/outfitVision';
import { selectOutfitCandidates } from '../utils/outfitMatch';
import { buildUnratedPairs, type ItemPair } from '../utils/pairs';
import type { RootStackParamList } from '../navigation/types';
import type { ClothingItem } from '../types/wardrobe';

/**
 * Nothing here writes to Item_Compatibility until the user taps "Confirm" on
 * the confirm step — the vision call only ever produces a proposal. See
 * confirm() below.
 */
type Stage =
  | { step: 'capture' }
  | { step: 'analyzing' }
  | { step: 'empty' }
  | { step: 'confirm'; identified: ClothingItem[]; pairs: ItemPair[] };

function CaptureStep({ onPicked }: { onPicked: (image: PickedImage) => void }) {
  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
      <Text className="text-base font-semibold text-slate-900 mb-1">Match from a photo</Text>
      <Text className="text-sm text-slate-500 mb-5">
        Take a mirror photo of an outfit. Closet items it recognises are offered as matches —
        nothing is saved until you confirm.
      </Text>
      <RawPhotoSourceChooser onPicked={onPicked} />
    </ScrollView>
  );
}

function AnalyzingStep() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50">
      <ActivityIndicator />
      <Text className="text-slate-500 mt-3">Identifying items…</Text>
    </View>
  );
}

function EmptyStep({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="flex-1 bg-slate-50">
      <EmptyState
        title="Nothing recognised"
        detail="No closet items were identified in that photo. Try a clearer shot, or rate pairs by hand instead."
      />
      <View className="p-4">
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="rounded-xl py-3.5 items-center bg-slate-900"
        >
          <Text className="text-white font-semibold">Try another photo</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A read-only thumbnail — unlike ItemTile, nothing here is tappable. */
function IdentifiedThumbnail({ item }: { item: ClothingItem }) {
  return (
    <View className="w-1/4 p-1">
      <View className="aspect-[3/4] rounded-lg overflow-hidden bg-white border border-slate-200">
        <StoredImage path={item.imagePath} placeholder="No photo" />
      </View>
      <Text className="text-xs text-slate-500 mt-1" numberOfLines={1}>
        {item.brand}
      </Text>
    </View>
  );
}

function PairRow({
  pair,
  selected,
  onToggle,
}: {
  pair: ItemPair;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      className={`flex-row items-center rounded-xl border p-2 mb-2 ${
        selected ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'
      }`}
    >
      <View className="w-10 h-14 rounded-lg overflow-hidden bg-slate-100 mr-2">
        <StoredImage path={pair.a.imagePath} placeholder="" />
      </View>
      <View className="w-10 h-14 rounded-lg overflow-hidden bg-slate-100 mr-3">
        <StoredImage path={pair.b.imagePath} placeholder="" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-slate-900" numberOfLines={1}>
          {pair.a.brand} + {pair.b.brand}
        </Text>
        <Text className="text-xs text-slate-500">
          {pair.a.category} · {pair.b.category}
        </Text>
      </View>
      <View
        className={`w-6 h-6 rounded-full items-center justify-center ${
          selected ? 'bg-emerald-600' : 'bg-slate-200'
        }`}
      >
        {selected ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
      </View>
    </Pressable>
  );
}

function IdentifiedSection({ identified }: { identified: ClothingItem[] }) {
  return (
    <>
      <Text className="text-sm font-semibold text-slate-900 mb-2">
        Identified {identified.length} {identified.length === 1 ? 'item' : 'items'}
      </Text>
      <View className="flex-row flex-wrap -mx-1 mb-4">
        {identified.map((item) => (
          <IdentifiedThumbnail key={item.id} item={item} />
        ))}
      </View>
    </>
  );
}

function ProposedMatchesSection({
  pairs,
  selectedKeys,
  onToggle,
}: {
  pairs: ItemPair[];
  selectedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (pairs.length === 0) {
    return (
      <Text className="text-sm text-slate-500">
        No new pairs to propose — every combination here is already rated.
      </Text>
    );
  }

  return (
    <>
      <Text className="text-sm font-semibold text-slate-900 mb-2">
        Proposed matches — tap one to leave it out
      </Text>
      {pairs.map((pair) => (
        <PairRow
          key={pair.key}
          pair={pair}
          selected={selectedKeys.has(pair.key)}
          onToggle={() => onToggle(pair.key)}
        />
      ))}
    </>
  );
}

function ConfirmStep({
  identified,
  pairs,
  selectedKeys,
  saving,
  onToggle,
  onConfirm,
}: {
  identified: ClothingItem[];
  pairs: ItemPair[];
  selectedKeys: ReadonlySet<string>;
  saving: boolean;
  onToggle: (key: string) => void;
  onConfirm: () => void;
}) {
  const confirmDisabled = saving || selectedKeys.size === 0;
  // This bar sits at the physical bottom edge of a modal screen with no tab
  // bar beneath it to absorb the home indicator's safe area — without adding
  // it back explicitly here, the button lands flush against the edge and is
  // hard to press accurately.
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-slate-50">
      <ScrollView contentContainerClassName="p-4">
        <IdentifiedSection identified={identified} />
        <ProposedMatchesSection pairs={pairs} selectedKeys={selectedKeys} onToggle={onToggle} />
      </ScrollView>

      <View
        className="p-4 bg-white border-t border-slate-200"
        style={{ paddingBottom: Math.max(16, insets.bottom + 12) }}
      >
        <Pressable
          onPress={onConfirm}
          disabled={confirmDisabled}
          accessibilityRole="button"
          className={`rounded-xl py-3.5 items-center ${confirmDisabled ? 'bg-slate-300' : 'bg-emerald-600'}`}
        >
          <Text className="text-white font-semibold">
            {saving
              ? 'Saving…'
              : `Confirm ${selectedKeys.size} ${selectedKeys.size === 1 ? 'match' : 'matches'}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Runs the vision call and builds the proposal, without writing anything.
 *
 * Reuses buildUnratedPairs — the definition of "a pair worth proposing" is
 * exactly the Speed Matcher's definition of "a pair worth asking about":
 * complementary categories, clears the belt-loop/hardware rules, and not
 * already rated.
 */
async function analyzeOutfitPhoto(photoUri: string): Promise<{
  identified: ClothingItem[];
  pairs: ItemPair[];
} | null> {
  return withDb(async (db) => {
    const items = await listItems(db);
    const candidates = selectOutfitCandidates(items);
    const identified = await identifyOutfitItems(photoUri, candidates, (item) =>
      imageUriFor(item.imagePath),
    );
    if (identified.length === 0) return null;

    const ratedKeys = await listRatedPairKeys(db);
    return { identified, pairs: buildUnratedPairs(identified, ratedKeys) };
  });
}

export function OutfitMatchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [stage, setStage] = useState<Stage>({ step: 'capture' });
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  async function handlePicked(photo: PickedImage) {
    setStage({ step: 'analyzing' });
    try {
      const result = await analyzeOutfitPhoto(photo.uri);
      if (!result) {
        setStage({ step: 'empty' });
        return;
      }
      // Every proposed pair starts selected; deselecting is the correction,
      // not the default, since the model already filtered to what it judged
      // was actually worn together.
      setSelectedKeys(new Set(result.pairs.map((pair) => pair.key)));
      setStage({ step: 'confirm', identified: result.identified, pairs: result.pairs });
    } catch (e) {
      console.error('Outfit matching failed:', e);
      Alert.alert('Could not analyze that photo', 'Please try again.');
      setStage({ step: 'capture' });
    }
  }

  function toggle(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function confirm(pairs: ItemPair[]) {
    const chosen = pairs.filter((pair) => selectedKeys.has(pair.key));
    if (chosen.length === 0) return;

    setSaving(true);
    try {
      await withDb(async (db) => {
        for (const pair of chosen) {
          await setCompatibility(db, pair.a.id, pair.b.id, 'MATCH');
        }
      });
      navigation.goBack();
    } catch (e) {
      console.error('Failed to save outfit matches:', e);
      Alert.alert('Could not save', 'Those matches were not recorded.');
    } finally {
      setSaving(false);
    }
  }

  switch (stage.step) {
    case 'capture':
      return <CaptureStep onPicked={(image) => void handlePicked(image)} />;
    case 'analyzing':
      return <AnalyzingStep />;
    case 'empty':
      return <EmptyStep onRetry={() => setStage({ step: 'capture' })} />;
    case 'confirm':
      return (
        <ConfirmStep
          identified={stage.identified}
          pairs={stage.pairs}
          selectedKeys={selectedKeys}
          saving={saving}
          onToggle={toggle}
          onConfirm={() => void confirm(stage.pairs)}
        />
      );
  }
}
