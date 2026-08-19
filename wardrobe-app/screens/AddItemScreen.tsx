import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OptionRow, PrimaryButton } from '../components/Form';
import { PhotoPreview, PhotoSourceChooser } from '../components/PhotoPicker';
import { ProposalReview, type ReviewedValues } from '../components/ProposalReview';
import { VoiceCapture } from '../components/VoiceCapture';
import { createItem } from '../services/itemActions';
import { withDb } from '../services/database';
import { isVoiceConfigured, openAIVoicePipeline } from '../services/voice';
import { ALL_CATEGORIES } from '../utils/categories';
import type { ItemProposal } from '../utils/proposals';
import type { RootStackParamList } from '../navigation/types';

/**
 * Where the add flow has got to.
 *
 * A union rather than a set of booleans because the flow keeps growing: 'voice'
 * is this phase's addition and slotted in without touching the others, and
 * background removal will add a processing step after 'preview' the same way.
 */
type Stage =
  | { step: 'capture' }
  | { step: 'preview'; imageUri: string }
  | { step: 'voice'; imageUri: string }
  | { step: 'confirm'; imageUri: string };

/**
 * Attributes applied straight from the model without a confirmation card.
 *
 * Warmth and wind are estimates on an arbitrary scale that a person cannot
 * usefully second-guess; hardware colour and belt loops only matter for a few
 * categories. All four stay editable on Item Details.
 */
type SilentFields = Pick<
  ItemProposal,
  'inferredWarmth' | 'inferredWind' | 'hardwareColor' | 'hasBeltLoops'
>;

export function AddItemScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddItem'>>();

  const [stage, setStage] = useState<Stage>({ step: 'capture' });
  const [proposal, setProposal] = useState<ItemProposal>({});
  const [saving, setSaving] = useState(false);

  const [values, setValues] = useState<ReviewedValues>({
    brand: 'Unknown',
    costMinorUnits: 0,
    primaryColor: '',
    secondaryColor: '',
    category: route.params?.category ?? 'T-Shirt',
    isSecondHand: false,
    materials: [],
  });
  const [silent, setSilent] = useState<SilentFields>({});

  function applyProposal(next: ItemProposal) {
    setProposal(next);
    setValues((current) => ({
      brand: next.brand ?? current.brand,
      costMinorUnits: next.costMinorUnits ?? current.costMinorUnits,
      primaryColor: next.primaryColor ?? current.primaryColor,
      secondaryColor: next.secondaryColor ?? current.secondaryColor,
      category: next.category ?? current.category,
      isSecondHand: next.isSecondHand ?? current.isSecondHand,
      materials: next.materials ?? current.materials,
    }));
    setSilent({
      inferredWarmth: next.inferredWarmth,
      inferredWind: next.inferredWind,
      hardwareColor: next.hardwareColor,
      hasBeltLoops: next.hasBeltLoops,
    });
  }

  async function save(imageUri: string) {
    setSaving(true);
    try {
      await createItem(
        { runQuery: withDb },
        {
          ...values,
          brand: values.brand.trim() || 'Unknown',
          hardwareColor: silent.hardwareColor ?? 'None',
          hasBeltLoops: silent.hasBeltLoops ?? false,
          inferredWarmth: silent.inferredWarmth ?? 0,
          inferredWind: silent.inferredWind ?? 0,
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
    const { imageUri } = stage;
    return (
      <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
        <PhotoPreview
          uri={imageUri}
          onAccept={() =>
            setStage(isVoiceConfigured() ? { step: 'voice', imageUri } : { step: 'confirm', imageUri })
          }
          onRetake={() => setStage({ step: 'capture' })}
        />
      </ScrollView>
    );
  }

  if (stage.step === 'voice') {
    const { imageUri } = stage;
    return (
      <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4 pt-10">
        <Text className="text-base font-semibold text-slate-900 text-center mb-1">
          Describe it
        </Text>
        <Text className="text-sm text-slate-500 text-center mb-8">
          Brand, price, colour — whatever you know.
        </Text>

        <VoiceCapture
          pipeline={openAIVoicePipeline}
          onProposal={(next) => {
            applyProposal(next);
            setStage({ step: 'confirm', imageUri });
          }}
        />

        <Pressable
          onPress={() => setStage({ step: 'confirm', imageUri })}
          accessibilityRole="button"
          className="py-4 mt-8 items-center"
        >
          <Text className="text-slate-500 font-medium">Skip and type it later</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const { imageUri } = stage;

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4 pb-10">
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

      <ProposalReview
        proposal={proposal}
        values={values}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
      />

      <OptionRow
        label="Category"
        options={ALL_CATEGORIES}
        value={values.category}
        onChange={(category) => setValues((current) => ({ ...current, category }))}
      />

      <View className="mt-2">
        <PrimaryButton
          label={saving ? 'Saving…' : 'Save item'}
          onPress={() => void save(imageUri)}
          disabled={saving}
        />
      </View>
    </ScrollView>
  );
}
