import { failureFromStatus, VoiceError } from '../utils/voiceErrors';

/**
 * Shared transport for the OpenAI calls this app makes.
 *
 * Transcription, attribute extraction and garment detection all need the same
 * key handling, timeout and error mapping, and getting any of those subtly
 * different between them would mean three ways for the same failure to be
 * reported.
 */

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * How long to wait before giving up on a call.
 *
 * Without this a stalled connection leaves the user on a screen that never
 * resolves — fetch has no timeout of its own.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Reads the key from an environment map.
 *
 * Exported and parameterised so the placeholder handling below is testable;
 * production callers use apiKey().
 */
export function readApiKey(env: Record<string, string | undefined>): string | null {
  const key = env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!key) return null;
  // The placeholder from .env.example. Someone who copied the file and did not
  // fill it in has no key, and should get the "not set up" path rather than a
  // 401 telling them their key was rejected.
  if (key.startsWith('[') && key.endsWith(']')) return null;
  return key;
}

/**
 * The key, read from the environment at build time.
 *
 * EXPO_PUBLIC_ values are inlined into the JS bundle in plain text and can be
 * extracted from any build of the app. Acceptable for a personal build running
 * on one phone; NOT acceptable for TestFlight or the App Store, which needs
 * these calls moved behind a server that holds the key.
 */
function apiKey(): string | null {
  return readApiKey(process.env);
}

/** Whether the AI-backed features can run at all. */
export function isAIConfigured(): boolean {
  return apiKey() !== null;
}

/** Runs a request with a timeout, mapping every failure onto a VoiceFailure. */
export async function callOpenAI(path: string, init: RequestInit): Promise<unknown> {
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
    throw new VoiceError(failureFromStatus(response.status), `OpenAI responded ${response.status}`);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new VoiceError('unusable-reply', 'response was not JSON');
  }
}

/** Pulls the assistant's JSON payload out of a chat completion, or throws. */
export function parseChatJson(body: unknown): unknown {
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string') {
    throw new VoiceError('unusable-reply', 'no message content in response');
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new VoiceError('unusable-reply', 'message content was not JSON');
  }
}
