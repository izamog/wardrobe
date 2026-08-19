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
  | 'rate-limited'
  | 'too-large'
  | 'timeout'
  | 'offline'
  | 'server'
  | 'unusable-reply'
  | 'empty-transcript';

export class VoiceError extends Error {
  constructor(
    readonly reason: VoiceFailure,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}

/**
 * Maps an HTTP status to a reason.
 *
 * 408 and 504 are timeouts the server reported, distinct from the client-side
 * abort that produces 'timeout' directly. Anything unrecognised is treated as
 * a server fault rather than a client one: the alternative is telling the user
 * to fix something that is not theirs to fix.
 */
export function failureFromStatus(status: number): VoiceFailure {
  if (status === 401 || status === 403) return 'unauthorized';
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
 */
export function describeVoiceFailure(reason: VoiceFailure): string {
  switch (reason) {
    case 'no-key':
      return 'Voice input is not set up on this build. You can type the details instead.';
    case 'unauthorized':
      return 'The voice service rejected the API key. Check it and try again.';
    case 'rate-limited':
      return 'Too many requests just now. Wait a moment and try again.';
    case 'too-large':
      return 'That recording was too long. Try a shorter description.';
    case 'timeout':
      return 'The voice service took too long to answer. Try again.';
    case 'offline':
      return 'No connection. Voice input needs the internet — you can type the details instead.';
    case 'server':
      return 'The voice service had a problem. Try again in a moment.';
    case 'unusable-reply':
      return "Could not make sense of that. Try describing the item again.";
    case 'empty-transcript':
      return 'Nothing was heard. Hold the button while you speak.';
  }
}
