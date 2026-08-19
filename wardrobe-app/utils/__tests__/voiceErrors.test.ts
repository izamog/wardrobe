/** @jest-environment node */
import {
  describeVoiceFailure,
  failureFromStatus,
  VoiceError,
  type VoiceFailure,
} from '../voiceErrors';

const ALL_FAILURES: VoiceFailure[] = [
  'no-key',
  'unauthorized',
  'rate-limited',
  'too-large',
  'timeout',
  'offline',
  'server',
  'unusable-reply',
  'empty-transcript',
];

describe('failureFromStatus', () => {
  it('separates a rejected key from a rate limit, which need different actions', () => {
    expect(failureFromStatus(401)).toBe('unauthorized');
    expect(failureFromStatus(403)).toBe('unauthorized');
    expect(failureFromStatus(429)).toBe('rate-limited');
  });

  it('recognises an oversized upload', () => {
    expect(failureFromStatus(413)).toBe('too-large');
  });

  it('recognises server-reported timeouts', () => {
    expect(failureFromStatus(408)).toBe('timeout');
    expect(failureFromStatus(504)).toBe('timeout');
  });

  it('blames the server for anything it does not recognise', () => {
    // Rather than telling the user to fix something that is not theirs.
    for (const status of [400, 404, 418, 500, 502, 503, 0]) {
      expect(failureFromStatus(status)).toBe('server');
    }
  });
});

describe('describeVoiceFailure', () => {
  it('has wording for every reason', () => {
    for (const reason of ALL_FAILURES) {
      expect(describeVoiceFailure(reason).length).toBeGreaterThan(0);
    }
  });

  it('gives each reason its own wording, so the next step differs', () => {
    const messages = ALL_FAILURES.map(describeVoiceFailure);
    expect(new Set(messages).size).toBe(ALL_FAILURES.length);
  });

  it('leaks no internals to the user', () => {
    for (const reason of ALL_FAILURES) {
      const message = describeVoiceFailure(reason);
      expect(message).not.toMatch(/http|json|token|endpoint|api\.openai|model|status/i);
    }
  });

  it('tells the user they can type instead when voice cannot work at all', () => {
    expect(describeVoiceFailure('no-key')).toMatch(/type/i);
    expect(describeVoiceFailure('offline')).toMatch(/type/i);
  });
});

describe('VoiceError', () => {
  it('carries the reason alongside the message', () => {
    const error = new VoiceError('timeout', 'aborted after 30s');
    expect(error.reason).toBe('timeout');
    expect(error).toBeInstanceOf(Error);
  });
});
