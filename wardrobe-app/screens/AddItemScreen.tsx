import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OptionRow, PrimaryButton } from '../components/Form';
import { PhotoSourceChooser } from '../components/PhotoPicker';
import { ProposalReview, type ReviewedValues } from '../components/ProposalReview';
import { VoiceBar } from '../components/VoiceCapture';
import { createItem } from '../services/itemActions';
import { withDb } from '../services/database';
import { isVoiceConfigured, openAIVoicePipeline } from '../services/voice';
import { ALL_CATEGORIES } from '../utils/categories';
import type { ItemProposal } from '../utils/proposals';
import type { RootStackParamList } from '../navigation/types';

/**
 * Where the add flow has got to.
 *
 * Only two steps now: the photo, then everything else on one screen. Voice used
 * to be a page of its own, which meant describing a garment you could no longer
 * see — the point of holding the button is to look at the piece while you talk
 * about it.
 */
type Stage = { step: 'capture' } | { step: 'compose'; imageUri: string };

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
  const [transcript, setTranscript] = useState<string | null>(null);
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
        <PhotoSourceChooser
          onPicked={(image) => {
            // The detector's guess seeds the category so a description that
            // never mentions one still lands somewhere sensible. Anything the
            // user says overrides it.
            if (image.detectedCategory) {
              setValues((current) => ({ ...current, category: image.detectedCategory! }));
            }
            setStage({ step: 'compose', imageUri: image.uri });
          }}
        />
      </ScrollView>
    );
  }

  const { imageUri } = stage;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="p-4 pb-6" keyboardShouldPersistTaps="handled">
        {/* Not pressable — replacing goes through the button, so a stray tap on
            a large image cannot throw away the form. */}
        <View className="aspect-[3/4] rounded-2xl overflow-hidden bg-slate-200 mb-3">
          <Image source={{ uri: imageUri }} className="w-full h-full" resizeMode="contain" />
        </View>
        <View className="mb-5">
          <PrimaryButton
            label="Replace image"
            tone="secondary"
            onPress={() => setStage({ step: 'capture' })}
          />
        </View>

        {transcript ? (
          <Text className="text-sm text-slate-500 italic mb-4">“{transcript}”</Text>
        ) : null}

        <ProposalReview
          proposal={proposal}
          values={values}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        />

        {/* Only when nothing proposed a category, so there is always exactly
            one place to set it and never two. Detection usually fills this in
            from the photo before a word is spoken. */}
        {proposal.category === undefined ? (
          <OptionRow
            label="Category"
            options={ALL_CATEGORIES}
            value={values.category}
            onChange={(category) => setValues((current) => ({ ...current, category }))}
          />
        ) : null}
      </ScrollView>

      <View className="flex-row items-center px-4 py-3 bg-white border-t border-slate-200">
        <View className="flex-1 mr-3">
          <PrimaryButton
            label={saving ? 'Saving…' : 'Save item'}
            onPress={() => void save(imageUri)}
            disabled={saving}
          />
        </View>
        {isVoiceConfigured() ? (
          <VoiceBar
            pipeline={openAIVoicePipeline}
            onProposal={applyProposal}
            onTranscript={setTranscript}
          />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
