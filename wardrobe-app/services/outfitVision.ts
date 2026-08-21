import * as ImageManipulator from 'expo-image-manipulator';
import { callOpenAI, parseChatJson, withModelFallback } from './openai';
import { filterKnownIds } from '../utils/outfitMatch';
import type { ClothingItem } from '../types/wardrobe';

/**
 * Identifying which closet items appear in a mirror-selfie outfit photo.
 *
 * Same shape as vision.ts's detectGarment: a resized, low-detail image per
 * call, a strict JSON schema reply, model fallback, and never throwing —
 * this is an optimisation over rating pairs by hand, not a step that can fail
 * the flow. A failure of any kind returns no matches, and the caller shows
 * "couldn't identify anything" rather than an error.
 */

const VISION_MODELS = process.env.EXPO_PUBLIC_OPENAI_TEXT_MODEL
  ? [process.env.EXPO_PUBLIC_OPENAI_TEXT_MODEL]
  : ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'];

/** Longest edge of the outfit photo sent for matching. */
const OUTFIT_IMAGE_SIZE = 512;

/**
 * Longest edge of each candidate's thumbnail.
 *
 * Much smaller than the outfit photo: a candidate thumbnail only has to be
 * recognisable, not detailed, and there can be up to MAX_OUTFIT_CANDIDATES of
 * them in one call.
 */
const CANDIDATE_THUMBNAIL_SIZE = 128;

const INSTRUCTIONS = [
  'You are shown one outfit photo, followed by a numbered list of candidate',
  'clothing items, each given as its id and a small photo of that item alone.',
  'Return the ids of every candidate that is being worn in the outfit photo.',
  'Judge by garment shape and colour; do not guess an item is present just',
  'because its category is plausible. If nothing in the list is worn in the',
  'photo, return an empty list.',
].join(' ');

function outfitMatchSchema(candidateIds: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['identifiedItemIds'],
    properties: {
      identifiedItemIds: {
        type: 'array',
        items: { type: 'string', enum: [...candidateIds] },
      },
    },
  };
}

interface EncodedImage {
  url: string;
}

/** Resizes and base64-encodes an image for a low-detail vision call. Null on any failure. */
async function encodeForVision(uri: string, width: number): Promise<EncodedImage | null> {
  try {
    const context = ImageManipulator.ImageManipulator.manipulate(uri);
    context.resize({ width });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    return saved.base64 ? { url: `data:image/jpeg;base64,${saved.base64}` } : null;
  } catch {
    return null;
  }
}

interface LabelledCandidate {
  item: ClothingItem;
  image: EncodedImage;
}

/** Encodes every candidate's thumbnail, silently dropping any whose photo can't be read. */
async function encodeCandidates(
  candidates: readonly ClothingItem[],
  resolveImageUri: (item: ClothingItem) => string | null,
): Promise<LabelledCandidate[]> {
  const labelled: LabelledCandidate[] = [];
  for (const item of candidates) {
    const source = resolveImageUri(item);
    if (!source) continue;
    const image = await encodeForVision(source, CANDIDATE_THUMBNAIL_SIZE);
    if (image) labelled.push({ item, image });
  }
  return labelled;
}

function buildMessageContent(outfitImage: EncodedImage, labelled: readonly LabelledCandidate[]) {
  return [
    { type: 'text', text: 'Outfit photo:' },
    { type: 'image_url', image_url: { url: outfitImage.url, detail: 'low' } },
    { type: 'text', text: 'Candidate closet items follow, each preceded by its id.' },
    ...labelled.flatMap(({ item, image }) => [
      { type: 'text', text: `id ${item.id}: ${item.category}, ${item.brand}` },
      { type: 'image_url', image_url: { url: image.url, detail: 'low' } },
    ]),
  ];
}

/**
 * Identifies which of `candidates` are worn in `outfitPhotoUri`.
 *
 * `resolveImageUri` is injected rather than importing services/images.ts
 * directly, so this module's non-native logic (the prompt, the schema, the id
 * validation) stays reachable without pulling in expo-file-system.
 *
 * Never throws. Returns an empty list on any failure — no key, no network, a
 * nonsense reply, or a candidate list too small to ask about.
 */
export async function identifyOutfitItems(
  outfitPhotoUri: string,
  candidates: readonly ClothingItem[],
  resolveImageUri: (item: ClothingItem) => string | null,
): Promise<ClothingItem[]> {
  if (candidates.length === 0) return [];

  try {
    const outfitImage = await encodeForVision(outfitPhotoUri, OUTFIT_IMAGE_SIZE);
    if (!outfitImage) return [];

    const labelled = await encodeCandidates(candidates, resolveImageUri);
    if (labelled.length === 0) return [];

    const candidateIds = labelled.map(({ item }) => item.id);

    const body = await withModelFallback('outfit-vision', VISION_MODELS, (model) =>
      callOpenAI('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: INSTRUCTIONS },
            { role: 'user', content: buildMessageContent(outfitImage, labelled) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'outfit_match',
              strict: true,
              schema: outfitMatchSchema(candidateIds),
            },
          },
        }),
      }),
    );

    const answer = parseChatJson(body) as { identifiedItemIds?: unknown };
    const keptIds = new Set(filterKnownIds(answer.identifiedItemIds, new Set(candidateIds)));

    return labelled.filter(({ item }) => keptIds.has(item.id)).map(({ item }) => item);
  } catch (e) {
    console.warn('Outfit matching failed', e);
    return [];
  }
}
