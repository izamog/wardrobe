import { parseExtraction, type ItemProposal } from '../utils/proposals';
import { ALL_CATEGORIES } from '../utils/categories';
import { ALL_COLORS } from '../utils/colors';
import { ALL_MATERIALS } from '../utils/materials';
import { failureFromStatus, VoiceError } from '../utils/voiceErrors';

/**
 * Turning a spoken description into proposed item attributes.
 *
 * Two calls, not one: a dedicated transcription model is markedly better at
 * hearing words than a general model is, and keeping them separate means the
 * transcript can be shown to the user as soon as it lands. When the extraction
 * gets something wrong, seeing what was actually heard explains why.
 */

/** Recommended file-transcription model. `whisper-1` remains available. */
const TRANSCRIPTION_MODEL = 'gpt-transcribe';
const EXTRACTION_MODEL = 'gpt-4o-mini';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * How long to wait before giving up on either call.
 *
 * Without this a stalled connection leaves the user holding a screen that
 * never resolves — fetch has no timeout of its own.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The key is read from the environment at build time.
 *
 * EXPO_PUBLIC_ values are inlined into the JS bundle in plain text and can be
 * extracted from any build of the app. That is acceptable for a personal build
 * running on one phone and is NOT acceptable for TestFlight or the App Store —
 * distribution needs this call moved behind a server that holds the key.
 */
function apiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  return key && key.trim() !== '' ? key.trim() : null;
}

export function isVoiceConfigured(): boolean {
  return apiKey() !== null;
}

/** Runs a request with a timeout, mapping every failure onto a VoiceFailure. */
async function callOpenAI(path: string, init: RequestInit): Promise<unknown> {
  const key = apiKey();
  if (key === null) throw new VoiceError('no-key', 'EXPO_PUBLIC_OPENAI_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...init.headers, Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    // fetch rejects for both an abort and a dead connection, and the two need
    // different wording, so they are told apart here rather than merged.
    if (controller.signal.aborted) throw new VoiceError('timeout', 'request timed out');
    throw new VoiceError('offline', `network request failed: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new VoiceError(
      failureFromStatus(response.status),
      `OpenAI responded ${response.status}`,
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new VoiceError('unusable-reply', 'response was not JSON');
  }
}

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
      category: nullableEnum(ALL_CATEGORIES),
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

  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string') {
    throw new VoiceError('unusable-reply', 'no message content in response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new VoiceError('unusable-reply', 'message content was not JSON');
  }

  return parseExtraction(parsed);
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
