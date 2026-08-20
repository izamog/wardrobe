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
import type { PreparedImage } from '../services/images';
import { AttributeList, type AttributeField, type AttributeValues } from '../components/AttributeList';
import { VoiceBar } from '../components/VoiceCapture';
import { BouncingDots } from '../components/BouncingDots';
import { createItem } from '../services/itemActions';
import { withDb } from '../services/database';
import { isVoiceConfigured, openAIVoicePipeline } from '../services/voice';
import type { ItemProposal } from '../utils/proposals';
import type { RootStackParamList } from '../navigation/types';
import { useProposalApplier, useImageRefiner, type Stage } from './addItemHooks';

/** Stable sets, so the list is not handed a new object on every render. */
const CATEGORY_LOADING: ReadonlySet<AttributeField> = new Set(['category']);
const EMPTY_FIELDS: ReadonlySet<AttributeField> = new Set();

/**
 * Fills in the silently-applied fields with their defaults before saving.
 *
 * Separated from save() so the branching around each default lives in one
 * small, easily-scanned place rather than inline in the object literal
 * createItem is called with.
 */
function withDefaults(
  values: AttributeValues,
  silent: Pick<ItemProposal, 'inferredWarmth' | 'inferredWind' | 'hardwareColor' | 'hasBeltLoops'>,
) {
  return {
    ...values,
    brand: values.brand.trim() || 'Unknown',
    hardwareColor: silent.hardwareColor ?? 'None',
    hasBeltLoops: silent.hasBeltLoops ?? false,
    inferredWarmth: silent.inferredWarmth ?? 0,
    inferredWind: silent.inferredWind ?? 0,
  };
}

/** The capture step: a prompt and the photo-source chooser, nothing else yet exists to show. */
function CapturePrompt({ onPicked }: { onPicked: (image: PreparedImage) => void }) {
  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerClassName="p-4">
      <Text className="text-base font-semibold text-slate-900 mb-1">Add a photo</Text>
      <Text className="text-sm text-slate-500 mb-5">
        Every item needs a picture. Photos are stored on this phone only.
      </Text>
      <PhotoSourceChooser onPicked={onPicked} />
    </ScrollView>
  );
}

/** The photo, its replace button and the last transcript, above the attribute list. */
function ComposeHeader({
  imageUri,
  refining,
  transcript,
  onReplaceImage,
}: {
  imageUri: string;
  refining: boolean;
  transcript: string | null;
  onReplaceImage: () => void;
}) {
  return (
    <View className="flex-row mb-4">
      {/* A third of the width, matching a closet tile. Full width here was
          most of a screen given to a photo the user has just looked at,
          pushing the attributes they came to check below the fold. */}
      <View className="w-1/3 aspect-[3/4] rounded-xl overflow-hidden bg-white border border-slate-200">
        <Image source={{ uri: imageUri }} className="w-full h-full" resizeMode="contain" />
        {/* Quiet, and in the corner: the picture is already usable, so this
            says "still improving", not "still loading". */}
        {refining ? (
          <View className="absolute bottom-1 right-1 bg-white/90 rounded-full px-2 py-1">
            <BouncingDots color="#64748b" />
          </View>
        ) : null}
      </View>

      <View className="flex-1 ml-4 justify-center">
        <Pressable
          onPress={onReplaceImage}
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
  );
}

interface PhotoProps {
  imageUri: string;
  refining: boolean;
  transcript: string | null;
  onReplaceImage: () => void;
}

interface AttributesProps {
  values: AttributeValues;
  pending: ReadonlySet<AttributeField>;
  loadingFields: ReadonlySet<AttributeField>;
  onValuesChange: (patch: Partial<AttributeValues>) => void;
  onResolve: (field: AttributeField) => void;
}

interface VoiceProps {
  onProposal: (proposal: ItemProposal) => void;
  onTranscript: (transcript: string) => void;
}

/**
 * The compose step: photo header, the attribute list, and the voice bar.
 *
 * Grouped into three prop bundles rather than one flat list — Codacy's
 * parameter-count check treats each destructured key as its own parameter,
 * and this screen genuinely has that many independent inputs.
 */
function ComposeView({
  photo,
  attributes,
  voice,
}: {
  photo: PhotoProps;
  attributes: AttributesProps;
  voice: VoiceProps;
}) {
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="p-4" keyboardShouldPersistTaps="handled">
        <ComposeHeader
          imageUri={photo.imageUri}
          refining={photo.refining}
          transcript={photo.transcript}
          onReplaceImage={photo.onReplaceImage}
        />
        <AttributeList
          values={attributes.values}
          pending={attributes.pending}
          loading={attributes.loadingFields}
          onChange={attributes.onValuesChange}
          onResolve={attributes.onResolve}
        />
      </ScrollView>

      {isVoiceConfigured() ? (
        <VoiceBar
          pipeline={openAIVoicePipeline}
          onProposal={voice.onProposal}
          onTranscript={voice.onTranscript}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function AddItemScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddItem'>>();

  const [stage, setStage] = useState<Stage>({ step: 'capture' });
  const [transcript, setTranscript] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<AttributeField>>(new Set());
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  // Detection must not overwrite a category the user picked or the recording
  // heard; it only fills a blank. It usually arrives first, but never reliably.
  const categoryTouched = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

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

  const applyProposal = useProposalApplier({ setValues, setPending, setSilent, categoryTouched });
  const { refinement, startRefinement } = useImageRefiner({
    alive,
    categoryTouched,
    setStage,
    setValues,
    setRefining,
  });

  const save = useCallback(async () => {
    setSaving(true);
    try {
      // Wait on the background crop rather than racing it: saving a second too
      // early would store the rough centred version permanently. The ref is
      // read after the await, so it holds whichever image won.
      await refinement.current;
      const imageUri = imageUriRef.current;
      if (!imageUri) return;

      await createItem({ runQuery: withDb }, withDefaults(values, silent), imageUri);
      navigation.goBack();
    } catch (e) {
      console.error('Failed to save item:', e);
      Alert.alert('Could not save', 'The item was not added. Please try again.');
      setSaving(false);
    }
  }, [navigation, silent, values, refinement]);

  // Save lives in the header rather than the bottom bar, which belongs to the
  // microphone. Two large targets side by side at the bottom edge left neither
  // of them comfortably reachable.
  const imageUri = stage.step === 'compose' ? stage.imageUri : null;
  // Mirrored into a ref because save() reads it *after* awaiting refinement,
  // by which time the state it closed over may be a crop that no longer exists.
  const imageUriRef = useRef<string | null>(imageUri);
  imageUriRef.current = imageUri;

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: imageUri
        ? () => (
            <Pressable
              onPress={() => void save()}
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
      <CapturePrompt
        onPicked={(image) => {
          // Straight to the details with a centred crop. Finding the garment
          // takes a round trip to a vision model, and making that the first
          // thing after picking a photo put a multi-second wait in front of
          // every item added. It runs behind this screen instead.
          setStage({ step: 'compose', imageUri: image.uri });
          startRefinement(image.source);
        }}
      />
    );
  }

  return (
    <ComposeView
      photo={{
        imageUri: stage.imageUri,
        refining,
        transcript,
        onReplaceImage: () => setStage({ step: 'capture' }),
      }}
      attributes={{
        values,
        pending,
        // Detection is still deciding what this is, so the row says so
        // rather than showing a default the user might take for an answer.
        loadingFields: refining && !categoryTouched.current ? CATEGORY_LOADING : EMPTY_FIELDS,
        onValuesChange: (patch) => {
          if (patch.category !== undefined) categoryTouched.current = true;
          setValues((current) => ({ ...current, ...patch }));
        },
        onResolve: (field) =>
          setPending((current) => {
            const next = new Set(current);
            next.delete(field);
            return next;
          }),
      }}
      voice={{ onProposal: applyProposal, onTranscript: setTranscript }}
    />
  );
}
