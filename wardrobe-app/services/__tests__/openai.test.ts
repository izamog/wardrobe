/**
 * @jest-environment node
 *
 * Only the key check is covered here. The network calls cannot be exercised
 * without a real key and a device, and mocking fetch would prove nothing about
 * OpenAI — the error mapping they rely on is tested in
 * utils/__tests__/voiceErrors.test.ts instead.
 */
/* global describe, it, expect */
import { readApiKey } from '../openai';

describe('readApiKey', () => {
  it('reads a key that is set', () => {
    expect(readApiKey({ EXPO_PUBLIC_OPENAI_API_KEY: 'sk-proj-real' })).toBe('sk-proj-real');
  });

  it('trims surrounding whitespace, which a copy-paste leaves behind', () => {
    expect(readApiKey({ EXPO_PUBLIC_OPENAI_API_KEY: '  sk-proj-real\n' })).toBe('sk-proj-real');
  });

  it('treats unset and empty as no key, so the voice step is skipped', () => {
    expect(readApiKey({})).toBeNull();
    expect(readApiKey({ EXPO_PUBLIC_OPENAI_API_KEY: '' })).toBeNull();
    expect(readApiKey({ EXPO_PUBLIC_OPENAI_API_KEY: '   ' })).toBeNull();
  });

  it('treats the .env.example placeholder as no key', () => {
    // Otherwise copying the file without editing it produces a 401 saying the
    // key was rejected, which sends the user looking for the wrong problem.
    expect(readApiKey({ EXPO_PUBLIC_OPENAI_API_KEY: '[ADD KEY HERE]' })).toBeNull();
  });
});
