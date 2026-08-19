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
  'forbidden',
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
    expect(failureFromStatus(429)).toBe('rate-limited');
  });

  it('separates a rejected key from a forbidden one', () => {
    // 401 means the key is wrong; 403 means the key is fine but the account
    // may not use what was asked for. Treating them alike sent the user off
    // to check a key that was never the problem.
    expect(failureFromStatus(401)).toBe('unauthorized');
    expect(failureFromStatus(403)).toBe('forbidden');
    expect(describeVoiceFailure('unauthorized')).not.toBe(describeVoiceFailure('forbidden'));
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
      // 'model' is allowed in the forbidden case: which model an account may
      // use is the actionable fact there, not an implementation detail.
      expect(message).not.toMatch(/http|json|token|endpoint|api\.openai|status/i);
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

  it("carries the service's own explanation when there is one", () => {
    const error = new VoiceError('forbidden', 'OpenAI responded 403', 'Model not found (404)');
    expect(error.detail).toBe('Model not found (404)');
  });

  it('has no detail when the service said nothing', () => {
    expect(new VoiceError('offline', 'no connection').detail).toBeUndefined();
  });
});
