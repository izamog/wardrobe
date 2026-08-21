/**
 * @jest-environment node
 *
 * Only the URL check is covered here. The network call cannot be exercised
 * without a running server and a device — see services/backgroundRemoval.ts.
 */
/* global describe, it, expect */
import { readBackgroundRemovalUrl } from '../backgroundRemoval';

describe('readBackgroundRemovalUrl', () => {
  it('reads a URL that is set', () => {
    expect(readBackgroundRemovalUrl({ EXPO_PUBLIC_BACKGROUND_REMOVAL_URL: 'http://192.168.1.142:8091' })).toBe(
      'http://192.168.1.142:8091',
    );
  });

  it('trims a trailing slash, so the endpoint path is not doubled up', () => {
    expect(readBackgroundRemovalUrl({ EXPO_PUBLIC_BACKGROUND_REMOVAL_URL: 'http://192.168.1.142:8091/' })).toBe(
      'http://192.168.1.142:8091',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(readBackgroundRemovalUrl({ EXPO_PUBLIC_BACKGROUND_REMOVAL_URL: '  http://x:8091  \n' })).toBe(
      'http://x:8091',
    );
  });

  it('treats unset and empty as not configured, so the plain photo is kept', () => {
    expect(readBackgroundRemovalUrl({})).toBeNull();
    expect(readBackgroundRemovalUrl({ EXPO_PUBLIC_BACKGROUND_REMOVAL_URL: '' })).toBeNull();
    expect(readBackgroundRemovalUrl({ EXPO_PUBLIC_BACKGROUND_REMOVAL_URL: '   ' })).toBeNull();
  });
});
