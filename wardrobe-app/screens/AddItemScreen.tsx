import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PhotoSourceChooser } from '../components/PhotoPicker';
import {
  ATTRIBUTE_FIELDS,
  AttributeList,
  type AttributeField,
  type AttributeValues,
} from '../components/AttributeList';
import { VoiceBar } from '../components/VoiceCapture';
import { createItem } from '../services/itemActions';
import { withDb } from '../services/database';
import { isVoiceConfigured, openAIVoicePipeline } from '../services/voice';
import type { ItemProposal } from '../utils/proposals';
import type { RootStackParamList } from '../navigation/types';

/**
 * Where the add flow has got to.
 *
 * Two steps: the photo, then everything else on one screen. Voice used to be a
 * page of its own, which meant describing a garment you could no longer see.
 */
type Stage = { step: 'capture' } | { step: 'compose'; imageUri: string };

/**
 * Delay between one heard attribute landing in the list and the next.
 *
 * The values arrive together; they are applied in sequence so the list fills
 * in visibly rather than changing in one jump. Slow enough to follow, fast
 * enough that six of them are done inside a second.
 */
const APPLY_INTERVAL_MS = 180;

/** Which proposal field feeds which row. */
const FIELD_SOURCES: Record<AttributeField, (p: ItemProposal) => Partial<AttributeValues> | null> = {
  category: (p) => (p.category === undefined ? null : { category: p.category }),
  brand: (p) => (p.brand === undefined ? null : { brand: p.brand }),
  cost: (p) => (p.costMinorUnits === undefined ? null : { costMinorUnits: p.costMinorUnits }),
  colors: (p) =>
    p.primaryColor === undefined
      ? null
      : { primaryColor: p.primaryColor, secondaryColor: p.secondaryColor ?? '' },
  isSecondHand: (p) => (p.isSecondHand === undefined ? null : { isSecondHand: p.isSecondHand }),
  materials: (p) => (p.materials === undefined ? null : { materials: p.materials }),
};

export function AddItemScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddItem'>>();

  const [stage, setStage] = useState<Stage>({ step: 'capture' });
  const [transcript, setTranscript] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<AttributeField>>(new Set());
  const [saving, setSaving] = useState(false);

  const [values, setValues] = useState<AttributeValues>({
    brand: 'Unknown',
    costMinorUnits: 0,
    primaryColor: '',
    secondaryColor: '',
    category: route.params?.category ?? 'T-Shirt',
    isSecondHand: false,
    materials: [],
  });
  // Warmth, wind, hardware and belt loops are estimates or category-specific
  // details, not questions worth confirming. Applied as heard, editable later.
  const [silent, setSilent] = useState<
    Pick<ItemProposal, 'inferredWarmth' | 'inferredWind' | 'hardwareColor' | 'hasBeltLoops'>
  >({});

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const applyProposal = useCallback((next: ItemProposal) => {
    setSilent({
      inferredWarmth: next.inferredWarmth,
      inferredWind: next.inferredWind,
      hardwareColor: next.hardwareColor,
      hasBeltLoops: next.hasBeltLoops,
    });

    const heard = ATTRIBUTE_FIELDS.filter((field) => FIELD_SOURCES[field](next) !== null);
    if (heard.length === 0) return;

    if (timer.current) clearInterval(timer.current);
    // A fresh recording supersedes the previous one, so old confirmations no
    // longer refer to anything.
    setPending(new Set());

    let index = 0;
    timer.current = setInterval(() => {
      const field = heard[index];
      setValues((current) => ({ ...current, ...FIELD_SOURCES[field](next) }));
      setPending((current) => new Set(current).add(field));

      index += 1;
      if (index >= heard.length && timer.current) clearInterval(timer.current);
    }, APPLY_INTERVAL_MS);
  }, []);

  const save = useCallback(
    async (imageUri: string) => {
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
    },
    [navigation, silent, values],
  );

  // Save lives in the header rather than the bottom bar, which belongs to the
  // microphone. Two large targets side by side at the bottom edge left neither
  // of them comfortably reachable.
  const imageUri = stage.step === 'compose' ? stage.imageUri : null;
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: imageUri
        ? () => (
            <Pressable
              onPress={() => void save(imageUri)}
              disabled={saving}
              accessibilityRole="button"
              className="px-2 py-1"
            >
              <Text
                className={`text-base font-semibold ${saving ? 'text-slate-300' : 'text-slate-900'}`}
              >
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, imageUri, save, saving]);

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

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="p-4" keyboardShouldPersistTaps="handled">
        <View className="flex-row mb-4">
          {/* A third of the width, matching a closet tile. Full width here was
              most of a screen given to a photo the user has just looked at,
              pushing the attributes they came to check below the fold. */}
          <View className="w-1/3 aspect-[3/4] rounded-xl overflow-hidden bg-white border border-slate-200">
            <Image source={{ uri: stage.imageUri }} className="w-full h-full" resizeMode="contain" />
          </View>

          <View className="flex-1 ml-4 justify-center">
            <Pressable
              onPress={() => setStage({ step: 'capture' })}
              accessibilityRole="button"
              className="self-start rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <Text className="text-sm font-medium text-slate-700">Replace image</Text>
            </Pressable>
            {transcript ? (
              <Text className="text-xs text-slate-500 italic mt-3" numberOfLines={4}>
                “{transcript}”
              </Text>
            ) : null}
          </View>
        </View>

        <AttributeList
          values={values}
          pending={pending}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          onResolve={(field) =>
            setPending((current) => {
              const next = new Set(current);
              next.delete(field);
              return next;
            })
          }
        />
      </ScrollView>

      {isVoiceConfigured() ? (
        <VoiceBar
          pipeline={openAIVoicePipeline}
          onProposal={applyProposal}
          onTranscript={setTranscript}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
