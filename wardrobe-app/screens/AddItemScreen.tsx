import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { FramedImage } from '../components/FramedImage';
import { AttributeList, type AttributeField, type AttributeValues } from '../components/AttributeList';
import { VoiceBar } from '../components/VoiceCapture';
import { BouncingDots } from '../components/BouncingDots';
import { createItem } from '../services/itemActions';
import { withDb } from '../services/database';
import { isVoiceConfigured, openAIVoicePipeline } from '../services/voice';
import { estimateWarmth, estimateWind } from '../utils/warmth';
import type { ItemProposal } from '../utils/proposals';
import type { RootStackParamList } from '../navigation/types';
import { useProposalApplier, useImageRefiner, type Stage } from './addItemHooks';

/** Stable empty set, so the list is not handed a new object on every render when nothing's loading. */
const EMPTY_FIELDS: ReadonlySet<AttributeField> = new Set();

/**
 * Which fields the background vision call is still deciding, given what's
 * already been touched by hand or by voice.
 *
 * category, sleeveLength and length all come back from the one vision call
 * (see GarmentDetection) and each independently stops "loading" the moment
 * something else — a tap, a spoken word — settles it first.
 */
function detectionLoadingFields(
  refining: boolean,
  touched: { category: boolean; sleeveLength: boolean; length: boolean },
): ReadonlySet<AttributeField> {
  if (!refining) return EMPTY_FIELDS;
  const loading: AttributeField[] = [];
  if (!touched.category) loading.push('category');
  if (!touched.sleeveLength) loading.push('sleeveLength');
  if (!touched.length) loading.push('length');
  return loading.length === 0 ? EMPTY_FIELDS : new Set(loading);
}

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
  // Voice only reports a warmth/wind estimate when the description actually
  // implied one (see EXTRACTION_INSTRUCTIONS in services/voice.ts). Absent
  // that, the deterministic category+material+sleeve table is a far better
  // default than a flat 0 — see utils/warmth.ts. sleeveLength is a visible
  // field now (see AttributeList), not a silent one, so it's read straight
  // off `values` rather than a fallback chain.
  return {
    ...values,
    brand: values.brand.trim() || 'Unknown',
    hardwareColor: silent.hardwareColor ?? 'None',
    hasBeltLoops: silent.hasBeltLoops ?? false,
    inferredWarmth:
      silent.inferredWarmth ??
      estimateWarmth(values.category, values.materials, values.sleeveLength, values.length),
    inferredWind:
      silent.inferredWind ??
      estimateWind(values.category, values.materials, values.sleeveLength, values.length),
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
  isFramed,
  refining,
  transcript,
  onReplaceImage,
}: {
  imageUri: string;
  isFramed: boolean;
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
        {/* isFramed: a cutout already has background-framer's margin baked
            in server-side; adding FramedImage's own margin on top of that
            would double it. The plain crop shown before refinement finishes
            has no such margin, so it still needs one. */}
        <FramedImage uri={imageUri} margin={isFramed ? 0 : undefined} />
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
  isFramed: boolean;
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
          isFramed={photo.isFramed}
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
  // Detection must not overwrite a category, sleeve length or length the
  // user picked or the recording heard; it only fills a blank. It usually
  // arrives first, but never reliably.
  const categoryTouched = useRef(false);
  const sleeveLengthTouched = useRef(false);
  const lengthTouched = useRef(false);
  const beltLoopsTouched = useRef(false);
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
    sleeveLength: 'Short',
    length: '',
    isSecondHand: false,
    materials: [],
  });
  // Warmth, wind, hardware and belt loops are estimates or category-specific
  // details, not questions worth confirming. Applied as heard, editable
  // later. sleeveLength and length used to be here too, but both are visible
  // and AI-detected the same way category is (see AttributeList and
  // useImageRefiner), so they belong in `values`, not this silent bucket.
  const [silent, setSilent] = useState<
    Pick<ItemProposal, 'inferredWarmth' | 'inferredWind' | 'hardwareColor' | 'hasBeltLoops'>
  >({});

  // The plain crop and, once known, the cutout -- tracked separately from
  // stage.imageUri (which prefers the cutout for display) because save() has
  // to persist both: the plain crop as originalImagePath, the cutout as
  // imagePath. Refs rather than state because save() reads them only after
  // awaiting refinement, by which time a state variable closed over earlier
  // may describe a crop that no longer exists. cutoutUriRef starts undefined
  // ("not attempted yet") and is only ever read after refinement resolves it
  // one way or the other -- see ItemPhoto in services/itemActions.ts.
  const originalUriRef = useRef<string | null>(null);
  const cutoutUriRef = useRef<string | null | undefined>(undefined);

  const applyProposal = useProposalApplier({
    setValues,
    setPending,
    setSilent,
    categoryTouched,
    sleeveLengthTouched,
    lengthTouched,
    beltLoopsTouched,
  });
  const { refinement, startRefinement } = useImageRefiner({
    alive,
    categoryTouched,
    sleeveLengthTouched,
    lengthTouched,
    beltLoopsTouched,
    setStage,
    setValues,
    setSilent,
    setRefining,
    onRefinedPhoto: ({ original, cutout }) => {
      originalUriRef.current = original;
      cutoutUriRef.current = cutout;
    },
  });

  const save = useCallback(async () => {
    setSaving(true);
    try {
      // Wait on the background crop rather than racing it: saving a second too
      // early would store the rough centred version permanently. The refs are
      // read after the await, so they hold whichever image won.
      await refinement.current;
      const original = originalUriRef.current;
      if (!original) return;

      await createItem(
        { runQuery: withDb },
        withDefaults(values, silent),
        { original, processed: cutoutUriRef.current },
      );
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

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: imageUri
        ? () => (
            <Pressable
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button"
              hitSlop={12}
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
          // and removing its background both take a round trip, and making
          // either the first thing after picking a photo put a multi-second
          // wait in front of every item added. Both run behind this screen
          // instead, while the user is describing the item.
          originalUriRef.current = image.uri;
          cutoutUriRef.current = undefined;
          setStage({ step: 'compose', imageUri: image.uri, isFramed: false });
          startRefinement(image.source);
        }}
      />
    );
  }

  return (
    <ComposeView
      photo={{
        imageUri: stage.imageUri,
        isFramed: stage.isFramed,
        refining,
        transcript,
        onReplaceImage: () => setStage({ step: 'capture' }),
      }}
      attributes={{
        values,
        pending,
        // Detection is still deciding what this is, so the row says so
        // rather than showing a default the user might take for an answer.
        loadingFields: detectionLoadingFields(refining, {
          category: categoryTouched.current,
          sleeveLength: sleeveLengthTouched.current,
          length: lengthTouched.current,
        }),
        onValuesChange: (patch) => {
          if (patch.category !== undefined) categoryTouched.current = true;
          if (patch.sleeveLength !== undefined) sleeveLengthTouched.current = true;
          if (patch.length !== undefined) lengthTouched.current = true;
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
