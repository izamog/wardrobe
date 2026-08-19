import React, { useState } from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OptionRow, PrimaryButton, SwitchField, TextField } from '../components/Form';
import { PhotoPreview, PhotoSourceChooser } from '../components/PhotoPicker';
import { createItem } from '../services/itemActions';
import { ALL_CATEGORIES } from '../utils/categories';
import { parseCost } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';
import type { Category } from '../types/wardrobe';

/**
 * Where the add flow currently is.
 *
 * Modelled as a union rather than a handful of booleans because the flow grows:
 * Phase 3 inserts a hold-to-talk step between 'preview' and 'form', and
 * background removal adds a processing step after capture. Each of those is a
 * new member here, not another flag to keep consistent with the others.
 */
type Stage =
  | { step: 'capture' }
  | { step: 'preview'; imageUri: string }
  | { step: 'form'; imageUri: string };

/**
 * The manual add form, now with a photo step in front of it.
 *
 * Still smaller than the full attribute set: the rest keep their column
 * defaults and are editable on Item Details. Phase 3's voice ingestion is what
 * fills them in without typing.
 */
export function AddItemScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddItem'>>();

  const [stage, setStage] = useState<Stage>({ step: 'capture' });
  const [category, setCategory] = useState<Category>(route.params?.category ?? 'T-Shirt');
  const [brand, setBrand] = useState('');
  const [cost, setCost] = useState('');
  const [isSecondHand, setIsSecondHand] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(imageUri: string) {
    const costMinorUnits = parseCost(cost);
    if (costMinorUnits === null) {
      Alert.alert('Check the cost', 'Enter a number like 24.99, or leave it blank.');
      return;
    }

    setSaving(true);
    try {
      await createItem(
        {
          category,
          brand: brand.trim() || 'Unknown',
          costMinorUnits,
          isSecondHand,
          materials: [],
          hardwareColor: 'None',
          hasBeltLoops: false,
          inferredWarmth: 0,
          inferredWind: 0,
        },
        imageUri,
      );
      navigation.goBack();
    } catch (e) {
      console.error('Failed to save item:', e);
      Alert.alert('Could not save', 'The item was not added. Please try again.');
      setSaving(false);
    }
  }

  if (stage.step === 'capture') {
    return (
      <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
        <Text className="text-base font-semibold text-slate-900 mb-1">Add a photo</Text>
        <Text className="text-sm text-slate-500 mb-5">
          Every item needs a picture. Photos are stored on this phone only.
        </Text>
        <PhotoSourceChooser onPicked={(imageUri) => setStage({ step: 'preview', imageUri })} />
      </ScrollView>
    );
  }

  if (stage.step === 'preview') {
    return (
      <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
        <PhotoPreview
          uri={stage.imageUri}
          onAccept={() => setStage({ step: 'form', imageUri: stage.imageUri })}
          onRetake={() => setStage({ step: 'capture' })}
        />
      </ScrollView>
    );
  }

  const { imageUri } = stage;

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4 pb-10">
      {/* Not pressable — replacing the photo is the button's job alone, so a
          stray tap on a large image cannot throw away the form. */}
      <View className="aspect-square rounded-2xl overflow-hidden bg-slate-200 mb-3">
        <Image source={{ uri: imageUri }} className="w-full h-full" resizeMode="cover" />
      </View>
      <View className="mb-5">
        <PrimaryButton
          label="Replace image"
          tone="secondary"
          onPress={() => setStage({ step: 'capture' })}
        />
      </View>

      <OptionRow
        label="Category"
        options={ALL_CATEGORIES}
        value={category}
        onChange={setCategory}
      />
      <TextField
        label="Brand or name"
        value={brand}
        onChangeText={setBrand}
        placeholder="Unknown"
      />
      <TextField
        label="Cost (£)"
        value={cost}
        onChangeText={setCost}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <SwitchField label="Bought second-hand" value={isSecondHand} onValueChange={setIsSecondHand} />

      <View className="mt-4">
        <PrimaryButton
          label={saving ? 'Saving…' : 'Save item'}
          onPress={() => void save(imageUri)}
          disabled={saving}
        />
      </View>
    </ScrollView>
  );
}
