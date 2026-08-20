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

/**
 * Pulls the human-readable reason out of an error response.
 *
 * OpenAI redacts the key in its own messages, so this is safe to show. Returns
 * undefined rather than throwing if the body is missing or unparseable — a
 * failure to read the explanation must not replace the failure it explains.
 */
async function describeErrorBody(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown; code?: unknown } };
    const message = typeof body.error?.message === 'string' ? body.error.message : undefined;
    const code = typeof body.error?.code === 'string' ? body.error.code : undefined;
    if (message && code) return `${message} (${code})`;
    return message ?? code;
  } catch {
    return undefined;
  }
}

/** Runs a request with a timeout, mapping every failure onto a VoiceFailure. */
export async function callOpenAI(path: string, init: RequestInit): Promise<unknown> {
  const key = apiKey();
  if (key === null) throw new VoiceError('no-key', 'EXPO_PUBLIC_OPENAI_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    // path is never user input: callOpenAI has two call sites (vision.ts,
    // voice.ts), both passing a hardcoded string literal endpoint.
    // nosemgrep
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
    // The body carries the only thing that identifies the problem — an unknown
    // model, a revoked key, an exhausted quota all arrive as bare statuses
    // otherwise. Read before throwing, and never let a malformed body mask the
    // real failure.
    throw new VoiceError(
      failureFromStatus(response.status),
      `OpenAI responded ${response.status} for ${path}`,
      await describeErrorBody(response),
    );
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

/**
 * Whether a failure means "this account cannot use that model" specifically.
 *
 * Distinguished from every other failure because it is the one worth reacting
 * to by trying something else: a project with a restricted model list rejects
 * one model while happily serving another, and a 403 there says nothing about
 * whether the next attempt will work.
 */
export function isModelUnavailable(error: unknown): boolean {
  if (!(error instanceof VoiceError)) return false;
  if (error.reason === 'forbidden') return true;
  const detail = error.detail?.toLowerCase() ?? '';
  return detail.includes('model_not_found') || detail.includes('does not have access to model');
}

/**
 * The model that last worked for a given purpose, remembered for the session.
 *
 * Without this every call would re-try the models the project has disabled,
 * paying a failed round trip each time before reaching the one that works.
 */
const workingModel = new Map<string, string>();

/** Test seam: forget which models were working. */
export function resetModelCache(): void {
  workingModel.clear();
}

/**
 * Runs `attempt` against the first model the account is actually allowed to use.
 *
 * Model availability is per-project and the user controls it in a dashboard
 * this app cannot see, so hard-coding one model makes the whole feature depend
 * on a setting nobody is looking at. Anything that is not a model-permission
 * problem is thrown straight away — retrying a bad key against four models
 * would just be four rejections.
 *
 * @throws the last failure when no candidate is permitted.
 */
export async function withModelFallback<T>(
  purpose: string,
  candidates: readonly string[],
  attempt: (model: string) => Promise<T>,
): Promise<T> {
  const known = workingModel.get(purpose);
  const ordered = known
    ? [known, ...candidates.filter((model) => model !== known)]
    : [...candidates];

  if (ordered.length === 0) {
    throw new VoiceError('unusable-reply', `no models configured for ${purpose}`);
  }

  let lastError: unknown;
  for (const model of ordered) {
    try {
      const result = await attempt(model);
      workingModel.set(purpose, model);
      return result;
    } catch (e) {
      if (!isModelUnavailable(e)) throw e;
      console.warn(`Model ${model} unavailable for ${purpose}; trying the next`, e);
      workingModel.delete(purpose);
      lastError = e;
    }
  }

  throw lastError;
}
