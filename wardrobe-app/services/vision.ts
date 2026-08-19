import * as ImageManipulator from 'expo-image-manipulator';
import { callOpenAI, parseChatJson, withModelFallback } from './openai';
import { parseDetectedBox, type NormalizedBox } from '../utils/cropGeometry';
import { ALL_CATEGORIES } from '../utils/categories';
import type { Category } from '../types/wardrobe';

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
 * The answer is four fractions and a word, so resolution beyond this buys
 * nothing and costs upload time and tokens on every item added.
 */
const DETECTION_IMAGE_SIZE = 512;

export interface GarmentDetection {
  /** Where the garment is, or null when nothing usable came back. */
  box: NormalizedBox | null;
  /** A guess at the category, or null. Always overridden by anything the user says. */
  category: Category | null;
}

const DETECTION_INSTRUCTIONS = [
  'You locate a single item of clothing in a photo.',
  'The photo is taken against a plain white background, so the garment is',
  'whatever is not white. Draw the box at the edge of the fabric.',
  'Return its bounding box as fractions of the image width and height, from 0 to 1,',
  'with the origin at the top left. Include the whole garment: sleeves, straps, hems.',
  'Exclude hangers, hands, furniture and background.',
  'Also name the category it most likely belongs to.',
  'If no clothing is visible, return null for the box.',
].join(' ');

function detectionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['box', 'category'],
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
    },
  };
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

    if (!small.base64) return { box: null, category: null };

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
                  image_url: { url: `data:image/jpeg;base64,${small.base64}`, detail: 'low' },
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

    const answer = parseChatJson(body) as { box?: unknown; category?: unknown };
    const category = ALL_CATEGORIES.find((entry) => entry === answer.category) ?? null;

    return { box: parseDetectedBox(answer.box), category };
  } catch (e) {
    console.warn('Garment detection failed; falling back to a centred crop', e);
    return { box: null, category: null };
  }
}
