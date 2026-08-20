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
import { refineCapturedImage, type PickedImage, type PreparedImage } from '../services/images';
import {
  ATTRIBUTE_FIELDS,
  AttributeList,
  type AttributeField,
  type AttributeValues,
} from '../components/AttributeList';
import { VoiceBar } from '../components/VoiceCapture';
import { BouncingDots } from '../components/BouncingDots';
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
 * A refinement running in the background, if one is.
 *
 * Held as a promise rather than a boolean so saving can wait on the same work
 * the screen is already doing, instead of racing it and storing the rougher
 * crop.
 */
type Refinement = Promise<void> | null;

/**
 * Delay between one heard attribute landing in the list and the next.
 *
 * The values arrive together; they are applied in sequence so the list fills
 * in visibly rather than changing in one jump. Slow enough to follow, fast
 * enough that six of them are done inside a second.
 */
const APPLY_INTERVAL_MS = 180;

/** Stable sets, so the list is not handed a new object on every render. */
const CATEGORY_LOADING: ReadonlySet<AttributeField> = new Set(['category']);
const EMPTY_FIELDS: ReadonlySet<AttributeField> = new Set();

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

/** The compose step: photo header, the attribute list, and the voice bar. */
function ComposeView({
  imageUri,
  refining,
  transcript,
  onReplaceImage,
  values,
  pending,
  loadingFields,
  onValuesChange,
  onResolve,
  onProposal,
  onTranscript,
}: {
  imageUri: string;
  refining: boolean;
  transcript: string | null;
  onReplaceImage: () => void;
  values: AttributeValues;
  pending: ReadonlySet<AttributeField>;
  loadingFields: ReadonlySet<AttributeField>;
  onValuesChange: (patch: Partial<AttributeValues>) => void;
  onResolve: (field: AttributeField) => void;
  onProposal: (proposal: ItemProposal) => void;
  onTranscript: (transcript: string) => void;
}) {
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="p-4" keyboardShouldPersistTaps="handled">
        <ComposeHeader
          imageUri={imageUri}
          refining={refining}
          transcript={transcript}
          onReplaceImage={onReplaceImage}
        />
        <AttributeList
          values={values}
          pending={pending}
          loading={loadingFields}
          onChange={onValuesChange}
          onResolve={onResolve}
        />
      </ScrollView>

      {isVoiceConfigured() ? (
        <VoiceBar pipeline={openAIVoicePipeline} onProposal={onProposal} onTranscript={onTranscript} />
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
  const refinement = useRef<Refinement>(null);
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

    // field is AttributeField, a closed union checked against FIELD_SOURCES's
    // keys — not external input, so this isn't a dynamic-dispatch risk.
    // nosemgrep
    const heard = ATTRIBUTE_FIELDS.filter((field) => FIELD_SOURCES[field](next) !== null);
    if (heard.length === 0) return;

    if (timer.current) clearInterval(timer.current);
    // A fresh recording supersedes the previous one, so old confirmations no
    // longer refer to anything.
    setPending(new Set());

    let index = 0;
    timer.current = setInterval(() => {
      const field = heard[index];
      if (field === 'category') categoryTouched.current = true;
      // field comes from `heard`, itself filtered from ATTRIBUTE_FIELDS above
      // — same closed AttributeField union, not external input.
      // nosemgrep
      setValues((current) => ({ ...current, ...FIELD_SOURCES[field](next) }));
      setPending((current) => new Set(current).add(field));

      index += 1;
      if (index >= heard.length && timer.current) clearInterval(timer.current);
    }, APPLY_INTERVAL_MS);
  }, []);

  const startRefinement = useCallback((source: PickedImage) => {
    setRefining(true);
    refinement.current = (async () => {
      const refined = await refineCapturedImage(source);
      if (!alive.current) return;

      if (refined.uri) setStage({ step: 'compose', imageUri: refined.uri });
      if (refined.detectedCategory && !categoryTouched.current) {
        setValues((current) => ({ ...current, category: refined.detectedCategory! }));
      }
      setRefining(false);
    })();
  }, []);

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
  }, [navigation, silent, values]);

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
      imageUri={stage.imageUri}
      refining={refining}
      transcript={transcript}
      onReplaceImage={() => setStage({ step: 'capture' })}
      values={values}
      pending={pending}
      // Detection is still deciding what this is, so the row says so
      // rather than showing a default the user might take for an answer.
      loadingFields={refining && !categoryTouched.current ? CATEGORY_LOADING : EMPTY_FIELDS}
      onValuesChange={(patch) => {
        if (patch.category !== undefined) categoryTouched.current = true;
        setValues((current) => ({ ...current, ...patch }));
      }}
      onResolve={(field) =>
        setPending((current) => {
          const next = new Set(current);
          next.delete(field);
          return next;
        })
      }
      onProposal={applyProposal}
      onTranscript={setTranscript}
    />
  );
}
