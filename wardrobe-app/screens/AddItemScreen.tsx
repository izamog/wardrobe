import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OptionRow, PrimaryButton, SwitchField, TextField } from '../components/Form';
import { insertItem } from '../services/items';
import { withDb } from '../services/database';
import { ALL_CATEGORIES } from '../utils/categories';
import { parseCost } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';
import type { Category } from '../types/wardrobe';

/**
 * The Phase 1.5 manual add form.
 *
 * Deliberately smaller than the full attribute set: this exists so the rest of
 * the app has items to work with before the camera (Phase 2) and voice
 * ingestion (Phase 3) land. The remaining attributes keep their column
 * defaults and are editable on Item Details. The photo steps get inserted
 * ahead of this form later; the save below is what they will feed.
 */
export function AddItemScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddItem'>>();

  const [category, setCategory] = useState<Category>(route.params?.category ?? 'Top');
  const [brand, setBrand] = useState('');
  const [cost, setCost] = useState('');
  const [isSecondHand, setIsSecondHand] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    const costMinorUnits = parseCost(cost);
    if (costMinorUnits === null) {
      Alert.alert('Check the cost', 'Enter a number like 24.99, or leave it blank.');
      return;
    }

    setSaving(true);
    try {
      await withDb((db) =>
        insertItem(db, {
          // No camera yet, so there is no image to point at. The tile renders a
          // placeholder for an empty uri; Phase 2 fills this in.
          imageUri: '',
          category,
          brand: brand.trim() || 'Unknown',
          costMinorUnits,
          isSecondHand,
          materials: [],
          hardwareColor: 'None',
          hasBeltLoops: false,
          inferredWarmth: 0,
          inferredWind: 0,
        }),
      );
      navigation.goBack();
    } catch (e) {
      console.error('Failed to save item:', e);
      Alert.alert('Could not save', 'The item was not added. Please try again.');
      setSaving(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4 pb-10">
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
        <PrimaryButton label={saving ? 'Saving…' : 'Save item'} onPress={save} disabled={saving} />
      </View>
    </ScrollView>
  );
}
