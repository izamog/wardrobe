import { parseExtraction, type ItemProposal } from '../utils/proposals';
import { ALL_CATEGORIES } from '../utils/categories';
import { ALL_COLORS } from '../utils/colors';
import { ALL_MATERIALS } from '../utils/materials';
import { VoiceError } from '../utils/voiceErrors';
import { callOpenAI, isAIConfigured, parseChatJson } from './openai';

/**
 * Turning a spoken description into proposed item attributes.
 *
 * Two calls, not one: a dedicated transcription model is markedly better at
 * hearing words than a general model is, and keeping them separate means the
 * transcript can be shown to the user as soon as it lands. When the extraction
 * gets something wrong, seeing what was actually heard explains why.
 */

export const isVoiceConfigured = isAIConfigured;

/** Recommended file-transcription model. `whisper-1` remains available. */
const TRANSCRIPTION_MODEL = 'gpt-transcribe';
const EXTRACTION_MODEL = 'gpt-4o-mini';

/**
 * Sends a recording for transcription.
 *
 * @param audioUri local file URI of the recording
 * @returns the transcript, never empty
 * @throws VoiceError for every failure mode, including a silent recording
 */
export async function transcribeAudio(audioUri: string): Promise<string> {
  const form = new FormData();
  // React Native's FormData takes this shape for a file part; it is not the
  // web Blob API.
  form.append('file', {
    uri: audioUri,
    name: 'description.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);
  form.append('model', TRANSCRIPTION_MODEL);

  const body = await callOpenAI('/audio/transcriptions', { method: 'POST', body: form });

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
      'inferredWarmth',
      'inferredWind',
    ],
    properties: {
      brand: { type: ['string', 'null'] },
      costInPounds: { type: ['number', 'null'] },
      colors: { type: 'array', items: { type: 'string', enum: [...ALL_COLORS] }, maxItems: 2 },
      // Not nullable: a category is always wanted, and the model can infer one
      // from any description of a garment even when none is stated.
      category: { type: 'string', enum: [...ALL_CATEGORIES] },
      isSecondHand: { type: ['boolean', 'null'] },
      materials: { type: 'array', items: { type: 'string', enum: [...ALL_MATERIALS] } },
      hardwareColor: nullableEnum(['Gold', 'Silver', 'None']),
      hasBeltLoops: { type: ['boolean', 'null'] },
      inferredWarmth: { type: ['number', 'null'] },
      inferredWind: { type: ['number', 'null'] },
    },
  };
}

const EXTRACTION_INSTRUCTIONS = [
  'You extract clothing attributes from a spoken description of a single garment.',
  'Return null for anything the description does not state or clearly imply.',
  'Do not guess a brand or a price: those are facts, and a wrong one is worse than none.',
  'category is the exception — always choose the closest one, inferring it from the',
  'garment described even when the speaker never names a category.',
  'costInPounds is the amount paid, in pounds, as a decimal number.',
  'inferredWarmth and inferredWind are your own estimates from 0 to 10 of how warm',
  'and how wind-resistant the garment is; estimate them even when unstated.',
].join(' ');

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
  const body = await callOpenAI('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      messages: [
        { role: 'system', content: EXTRACTION_INSTRUCTIONS },
        { role: 'user', content: transcript },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'item_attributes', strict: true, schema: extractionSchema() },
      },
    }),
  });

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
