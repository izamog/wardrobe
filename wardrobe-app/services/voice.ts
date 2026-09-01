import { parseExtraction, type ItemProposal } from '../utils/proposals';
import { ALL_CATEGORIES } from '../utils/categories';
import { ALL_COLORS } from '../utils/colors';
import { ALL_MATERIALS } from '../utils/materials';
import { VoiceError } from '../utils/voiceErrors';
import { callOpenAI, isAIConfigured, parseChatJson, withModelFallback } from './openai';

/**
 * Turning a spoken description into proposed item attributes.
 *
 * Two calls, not one: a dedicated transcription model is markedly better at
 * hearing words than a general model is, and keeping them separate means the
 * transcript can be shown to the user as soon as it lands. When the extraction
 * gets something wrong, seeing what was actually heard explains why.
 */

export const isVoiceConfigured = isAIConfigured;

/**
 * Transcription models to try, cheapest and most widely available first.
 *
 * A list rather than one name because model access is per-project and set in a
 * dashboard this app cannot read: a project with a restricted allow-list
 * rejects one model and serves another, and picking a single name makes the
 * whole feature depend on a setting nobody is looking at. The first permitted
 * one wins and is remembered for the session.
 *
 * EXPO_PUBLIC_OPENAI_TRANSCRIBE_MODEL pins one explicitly if needed.
 */
const TRANSCRIPTION_MODELS = process.env.EXPO_PUBLIC_OPENAI_TRANSCRIBE_MODEL
  ? [process.env.EXPO_PUBLIC_OPENAI_TRANSCRIBE_MODEL]
  : ['gpt-4o-mini-transcribe', 'whisper-1', 'gpt-4o-transcribe', 'gpt-transcribe'];

const EXTRACTION_MODELS = process.env.EXPO_PUBLIC_OPENAI_TEXT_MODEL
  ? [process.env.EXPO_PUBLIC_OPENAI_TEXT_MODEL]
  : ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'];

/**
 * Sends a recording for transcription.
 *
 * @param audioUri local file URI of the recording
 * @returns the transcript, never empty
 * @throws VoiceError for every failure mode, including a silent recording
 */
export async function transcribeAudio(audioUri: string): Promise<string> {
  const body = await withModelFallback('transcribe', TRANSCRIPTION_MODELS, (model) => {
    // Rebuilt per attempt: a FormData body cannot be replayed once consumed.
    const form = new FormData();
    // React Native's FormData takes this shape for a file part; it is not the
    // web Blob API.
    form.append('file', {
      uri: audioUri,
      name: 'description.m4a',
      type: 'audio/m4a',
    } as unknown as Blob);
    form.append('model', model);

    return callOpenAI('/audio/transcriptions', { method: 'POST', body: form });
  });

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== 'string') throw new VoiceError('unusable-reply', 'no text in response');

  const transcript = text.trim();
  if (transcript === '') throw new VoiceError('empty-transcript', 'transcript was empty');
  return transcript;
}

/**
 * The schema the model must answer in.
 *
 * Enumerated vocabularies are inlined so the model is told what the valid
 * answers are rather than guessing at them. This narrows the shape of a reply;
 * it guarantees nothing about the values, which is why parseExtraction still
 * checks every one of them.
 */
function extractionSchema() {
  const nullableEnum = (values: readonly string[]) => ({
    type: ['string', 'null'],
    enum: [...values, null],
  });

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'brand',
      'costInPounds',
      'colors',
      'category',
      'isSecondHand',
      'materials',
      'hardwareColor',
      'hasBeltLoops',
      'sleeveLength',
      'length',
      'inferredWarmth',
      'inferredWind',
      'purchasedAt',
    ],
    properties: {
      brand: { type: ['string', 'null'] },
      costInPounds: { type: ['number', 'null'] },
      colors: { type: 'array', items: { type: 'string', enum: [...ALL_COLORS] }, maxItems: 2 },
      // Not nullable: a category is always wanted, and the model can infer one
      // from any description of a garment even when none is stated.
      category: { type: 'string', enum: [...ALL_CATEGORIES] },
      isSecondHand: { type: ['boolean', 'null'] },
      materials: { type: 'array', items: { type: 'string', enum: [...ALL_MATERIALS] }, maxItems: 2 },
      hardwareColor: nullableEnum(['Gold', 'Silver', 'Brass', 'Black', 'None']),
      hasBeltLoops: { type: ['boolean', 'null'] },
      sleeveLength: nullableEnum(['Sleeveless', 'Short', 'Long']),
      // Pants and Skirt each have their own vocabulary; the schema doesn't
      // know which category applies yet, so it accepts either — parseExtraction
      // (utils/proposals.ts) is what checks the value against the right one
      // once category is resolved.
      length: nullableEnum([
        'Short',
        'Mid-length',
        'Capri',
        'Cropped',
        'Long',
        'Mini',
        'Knee-length',
        'Midi',
        'Maxi',
      ]),
      inferredWarmth: { type: ['number', 'null'] },
      inferredWind: { type: ['number', 'null'] },
      // Not an enum: a free "YYYY-MM" the model computes from today's date —
      // see EXTRACTION_INSTRUCTIONS. utils/proposals.ts checks the shape,
      // same as every other field here; structured output guarantees a
      // string, not that it parses.
      purchasedAt: { type: ['string', 'null'] },
    },
  };
}

const EXTRACTION_INSTRUCTIONS_BASE = [
  'You extract clothing attributes from a spoken description of a single garment.',
  'Return null for anything the description does not state or clearly imply.',
  'Do not guess a brand or a price: those are facts, and a wrong one is worse than none.',
  'category is the exception — always choose the closest one, inferring it from the',
  'garment described even when the speaker never names a category.',
  'Shirt means a button-up upper-body garment specifically — a blouse counts as a',
  'Shirt. Top means any other upper-body garment that is not a Shirt and not a',
  'T-Shirt: a vest, camisole, tank or plain jersey top with no buttons.',
  'costInPounds is the amount paid, in pounds, as a decimal number.',
  'sleeveLength is Sleeveless, Short or Long, only for a garment with a bodice or an',
  'arm hole — return null for anything else, and null if the description does not say.',
  'length applies only to Pants or a Skirt. For Pants use Short, Mid-length, Capri,',
  'Cropped or Long. For a Skirt use Mini, Knee-length, Midi or Maxi. Return null for',
  'every other category, and null if the description does not say.',
  'inferredWarmth and inferredWind are 0-to-10 estimates of how warm and how',
  'wind-resistant the garment is. Only return a value when the description actually',
  'implies one — "thick", "lightweight", "just a light jacket" — the same rule as every',
  'other field. The app already estimates both from category and material on its own,',
  'so leaving them null when nothing was said is the correct answer, not a missed one.',
].join(' ');

/**
 * Built per call, not a module-level constant like the base instructions
 * above — it has to name today's actual date so the model can turn a
 * relative duration ("a couple of years ago", "last spring") into a concrete
 * month, the same way a person would work it out.
 */
function extractionInstructions(today: Date): string {
  const todayIso = today.toISOString().slice(0, 10);
  return [
    EXTRACTION_INSTRUCTIONS_BASE,
    `purchasedAt is the month the item was bought, as a "YYYY-MM" string, computed`,
    `relative to today's date (${todayIso}). Only return one when the description`,
    'actually implies a time frame — a stated month and year, a season ("last spring"),',
    'or a rough duration ("a couple of years ago", "a few months back") — rounding a',
    'vague duration to the nearest month. When only a month is stated with no year',
    "(\"I bought it in May\"), infer the year as the most recent occurrence of that",
    "month at or before today — this year's if that month has already started this",
    'year, last year\'s otherwise. Return null when the description says nothing',
    'about when it was bought.',
  ].join(' ');
}

/**
 * Reads item attributes out of a transcript.
 *
 * Returns an empty proposal rather than throwing when the model answers with
 * nothing usable: a description that mentioned no attributes is a normal
 * outcome, not an error.
 *
 * @throws VoiceError only for transport and configuration failures.
 */
export async function extractItemAttributes(transcript: string): Promise<ItemProposal> {
  const body = await withModelFallback('text', EXTRACTION_MODELS, (model) =>
    callOpenAI('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: extractionInstructions(new Date()) },
          { role: 'user', content: transcript },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'item_attributes', strict: true, schema: extractionSchema() },
        },
      }),
    }),
  );

  return parseExtraction(parseChatJson(body));
}

/** The two steps, injectable so screens can be driven with fakes. */
export interface VoicePipeline {
  transcribe(audioUri: string): Promise<string>;
  extract(transcript: string): Promise<ItemProposal>;
}

export const openAIVoicePipeline: VoicePipeline = {
  transcribe: transcribeAudio,
  extract: extractItemAttributes,
};
