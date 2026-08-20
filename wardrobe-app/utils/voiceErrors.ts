/**
 * Why a voice ingestion attempt produced nothing usable.
 *
 * Separated from the message shown to the user so the mapping from HTTP
 * status to reason, and from reason to wording, can both be tested without a
 * network — which is the only part of this pipeline that can be.
 */
export type VoiceFailure =
  | 'no-key'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'too-large'
  | 'timeout'
  | 'offline'
  | 'server'
  | 'unusable-reply'
  | 'empty-transcript';

export class VoiceError extends Error {
  /**
   * What the service itself said, when it said anything.
   *
   * Kept separate from the wording shown to the user: the reasons below are
   * deliberately vague, and this is the line that actually identifies the
   * problem — a disabled model, a revoked key, an exhausted quota. Losing it
   * meant a 401 and a 403 were indistinguishable from the outside.
   */
  readonly detail?: string;

  constructor(reason: VoiceFailure, message: string, detail?: string);
  constructor(
    readonly reason: VoiceFailure,
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = 'VoiceError';
    this.detail = detail;
  }
}

/**
 * Maps an HTTP status to a reason.
 *
 * 401 and 403 are kept apart because they call for opposite actions: 401 means
 * the key is wrong, 403 means the key is fine but this account may not use
 * what was asked for — usually a model the project has not enabled. Telling
 * someone to check a working key sends them looking in the wrong place.
 *
 * 408 and 504 are timeouts the server reported, distinct from the client-side
 * abort that produces 'timeout' directly. Anything unrecognised is treated as
 * a server fault rather than a client one: the alternative is telling the user
 * to fix something that is not theirs to fix.
 */
export function failureFromStatus(status: number): VoiceFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 413) return 'too-large';
  if (status === 429) return 'rate-limited';
  return 'server';
}

/**
 * What to tell the user.
 *
 * Each reason gets its own wording because each has a different next step, and
 * "something went wrong" leaves someone retrying a thing that will never work.
 * Deliberately says nothing about endpoints, models or response bodies.
 *
 * A Record rather than a switch: TypeScript requires every VoiceFailure to
 * have an entry, so a new reason added to the union is a compile error here
 * rather than a silent fallthrough.
 */
const VOICE_FAILURE_MESSAGES: Record<VoiceFailure, string> = {
  'no-key': 'Voice input is not set up on this build. You can type the details instead.',
  unauthorized: 'The API key was rejected. Check it in .env, then restart with: npx expo start -c',
  forbidden:
    'The key is valid but this account is not allowed to use that model. See the details below.',
  'rate-limited': 'Too many requests just now. Wait a moment and try again.',
  'too-large': 'That recording was too long. Try a shorter description.',
  timeout: 'The voice service took too long to answer. Try again.',
  offline: 'No connection. Voice input needs the internet — you can type the details instead.',
  server: 'The voice service had a problem. Try again in a moment.',
  'unusable-reply': 'Could not make sense of that. Try describing the item again.',
  'empty-transcript': 'Nothing was heard. Hold the button while you speak.',
};

export function describeVoiceFailure(reason: VoiceFailure): string {
  return VOICE_FAILURE_MESSAGES[reason];
}
