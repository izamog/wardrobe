import * as ImageManipulator from 'expo-image-manipulator';
import { callOpenAI, parseChatJson, withModelFallback } from './openai';
import { parseDetectedBox, type NormalizedBox } from '../utils/cropGeometry';
import { ALL_CATEGORIES, beltLoopsApply, lengthOptionsFor, sleeveLengthApplies } from '../utils/categories';
import type { Category, GarmentLength, SleeveLength } from '../types/wardrobe';

const SLEEVE_LENGTHS: readonly SleeveLength[] = ['Sleeveless', 'Short', 'Long'];

/** Every length term across both vocabularies — the JSON schema doesn't yet know which category was detected. */
const ALL_LENGTHS: readonly GarmentLength[] = [
  'Short',
  'Mid-length',
  'Capri',
  'Cropped',
  'Long',
  'Mini',
  'Knee-length',
  'Midi',
  'Maxi',
];

/**
 * Finding the garment in a photo.
 *
 * The model is asked only for an outline and a guess at what the piece is —
 * both cheap to check and harmless to get wrong, because a bad outline falls
 * back to a centred crop and a bad category is one tap to change. The geometry
 * that turns an outline into a crop lives in utils/cropGeometry.ts, which is
 * pure and tested; this file is only the call.
 */

/** Same pool as extraction: both need a model this project is allowed to use. */
const VISION_MODELS = process.env.EXPO_PUBLIC_OPENAI_TEXT_MODEL
  ? [process.env.EXPO_PUBLIC_OPENAI_TEXT_MODEL]
  : ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'];

/**
 * Longest edge of the image sent for detection.
 *
 * Was 512 with `detail: 'low'`, sized for a box, a category and a word — all
 * coarse judgements. Belt loops are not: they're small fabric loops sewn
 * along the waistband, easy to lose entirely at 512px and OpenAI's low-detail
 * downsampling, which is why detection was under-reporting them. Both were
 * raised together — a bigger image sent at low detail still gets downsampled
 * to the same small tile size, so the resolution bump only pays off alongside
 * the detail change below.
 */
const DETECTION_IMAGE_SIZE = 768;

export interface GarmentDetection {
  /** Where the garment is, or null when nothing usable came back. */
  box: NormalizedBox | null;
  /** A guess at the category, or null. Always overridden by anything the user says. */
  category: Category | null;
  /**
   * A guess at sleeve length, or null — including when the detected category
   * has no sleeves to have a length (see sleeveLengthApplies). Asked in the
   * same call as category rather than a separate one: it's the same visual
   * judgement about the same garment, and a second round trip per item added
   * would double the latency for one more field.
   */
  sleeveLength: SleeveLength | null;
  /**
   * A guess at how long a Pants or Skirt item is, or null — including when the
   * detected category is neither (see lengthApplies). Same reasoning as
   * sleeveLength: one visual judgement, asked in the same call.
   */
  length: GarmentLength | null;
  /**
   * A guess at whether a Pants item has belt loops, or null — including when
   * the detected category isn't Pants (see beltLoopsApply). Same reasoning as
   * sleeveLength and length: one visual judgement, asked in the same call.
   * Unlike those two, this stays a silent field (see AttributeList) — belt
   * loops are a minor detail nobody needs to confirm, only correct later if
   * wrong.
   */
  hasBeltLoops: boolean | null;
}

const DETECTION_INSTRUCTIONS = [
  'You locate a single item of clothing in a photo.',
  'The photo is taken against a plain white background. Draw the box at the',
  'true edge of the fabric, including any part of the garment that is itself',
  'white, cream or pale — a white sleeve, collar or hem is still the garment,',
  'not the background. When in doubt about where the fabric ends, draw the',
  'box slightly generous rather than tight.',
  'Return its bounding box as fractions of the image width and height, from 0 to 1,',
  'with the origin at the top left. Include the whole garment: sleeves, straps, hems.',
  'Exclude hangers, hands, furniture and background.',
  'Also name the category it most likely belongs to.',
  'If the garment has a bodice or an arm hole (a top, a jacket, a dress — not trousers,',
  'shoes or an accessory), also judge its sleeve length as Sleeveless, Short or Long;',
  'otherwise return null for sleeve length.',
  'If the category is Pants (trousers or shorts), judge its length as one of Short,',
  'Mid-length, Capri, Cropped or Long. If the category is Skirt, judge its length as',
  'one of Mini, Knee-length, Midi or Maxi. For any other category, return null for length.',
  'If the category is Pants, also look closely along the entire top edge of the waistband —',
  'front, sides and back, not just what is facing the camera — for belt loops: small fabric',
  'loops, usually the same colour as the garment, sewn upright at intervals so a belt can be',
  'threaded through them. They are thin and easy to miss at a glance, so look carefully before',
  'deciding; do not assume a garment has none just because none are obvious at first look.',
  'For any other category, return null for hasBeltLoops.',
  'If no clothing is visible, return null for the box.',
].join(' ');

function detectionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['box', 'category', 'sleeveLength', 'length', 'hasBeltLoops'],
    properties: {
      box: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['x0', 'y0', 'x1', 'y1'],
        properties: {
          x0: { type: 'number' },
          y0: { type: 'number' },
          x1: { type: 'number' },
          y1: { type: 'number' },
        },
      },
      category: { type: ['string', 'null'], enum: [...ALL_CATEGORIES, null] },
      sleeveLength: { type: ['string', 'null'], enum: [...SLEEVE_LENGTHS, null] },
      length: { type: ['string', 'null'], enum: [...ALL_LENGTHS, null] },
      hasBeltLoops: { type: ['boolean', 'null'] },
    },
  };
}

type DetectionAnswer = {
  box?: unknown;
  category?: unknown;
  sleeveLength?: unknown;
  length?: unknown;
  hasBeltLoops?: unknown;
};

/**
 * Turns the model's raw answer into a GarmentDetection, checking each field
 * against its own vocabulary and against whatever category was itself
 * detected — the model is an input source, not an authority, the same rule
 * parseDetectedBox and utils/proposals.ts apply to every other AI answer.
 */
function parseDetectionAnswer(answer: DetectionAnswer): GarmentDetection {
  const category = ALL_CATEGORIES.find((entry) => entry === answer.category) ?? null;
  const rawSleeveLength = SLEEVE_LENGTHS.find((entry) => entry === answer.sleeveLength) ?? null;
  // Discarded rather than trusted when the detected category has no sleeves
  // to have a length — the same rule ItemDetailsScreen's buildItemUpdate
  // applies when a category changes underneath a stored value.
  const sleeveLength = category && sleeveLengthApplies(category) ? rawSleeveLength : null;

  // Same rule as sleeveLength, but the valid vocabulary also depends on
  // *which* category was detected (Pants and Skirt each have their own —
  // see lengthOptionsFor), not just whether one applies at all.
  const validLengths = category ? lengthOptionsFor(category) : [];
  const length = validLengths.find((entry) => entry === answer.length) ?? null;

  // Same rule again: only trusted for Pants, and only when it's actually a
  // boolean — a model returning "true"/1 here is not the guarantee
  // structured output implies, so it's checked, not assumed.
  const hasBeltLoops =
    category && beltLoopsApply(category) && typeof answer.hasBeltLoops === 'boolean'
      ? answer.hasBeltLoops
      : null;

  return { box: parseDetectedBox(answer.box), category, sleeveLength, length, hasBeltLoops };
}

/**
 * Asks where the garment is and what it probably is.
 *
 * Never throws: detection is an optimisation, not a requirement. A failure of
 * any kind — no key, no network, a nonsense answer — returns nulls, and the
 * caller falls back to a centred crop and an unset category. Making the user
 * re-take a usable photo because a bounding box could not be fetched would be
 * the wrong trade.
 */
export async function detectGarment(imageUri: string): Promise<GarmentDetection> {
  try {
    const context = ImageManipulator.ImageManipulator.manipulate(imageUri);
    context.resize({ width: DETECTION_IMAGE_SIZE });
    const rendered = await context.renderAsync();
    const small = await rendered.saveAsync({
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });

    if (!small.base64) {
      return { box: null, category: null, sleeveLength: null, length: null, hasBeltLoops: null };
    }

    const body = await withModelFallback('vision', VISION_MODELS, (model) =>
      callOpenAI('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: DETECTION_INSTRUCTIONS },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  // 'high' rather than 'low': belt loops need enough resolution
                  // to actually resolve, see DETECTION_IMAGE_SIZE. Costs more
                  // tokens per item added, which is an acceptable trade for a
                  // detail that was being missed outright at 'low'.
                  image_url: { url: `data:image/jpeg;base64,${small.base64}`, detail: 'high' },
                },
              ],
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'garment_detection', strict: true, schema: detectionSchema() },
          },
        }),
      }),
    );

    return parseDetectionAnswer(parseChatJson(body) as DetectionAnswer);
  } catch (e) {
    console.warn('Garment detection failed; falling back to a centred crop', e);
    return { box: null, category: null, sleeveLength: null, length: null, hasBeltLoops: null };
  }
}
