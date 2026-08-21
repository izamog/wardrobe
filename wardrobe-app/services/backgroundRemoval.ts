import { File, Paths } from 'expo-file-system';

/**
 * Cuts a garment out from its photo's background, via a self-hosted withoutBG
 * server (github.com/withoutbg/withoutbg-inference) rather than a paid API.
 *
 * Not unit-testable off-device: like services/images.ts, this touches the
 * filesystem and the network. Never throws — a cutout is an improvement over
 * the plain photo, not a step that can fail the save flow, so any problem
 * (server unset, unreachable, slow, or a bad reply) is swallowed and reported
 * as null, and itemActions falls back to the original photo.
 */

/** Longest a self-hosted, CPU-only inference call is allowed to take. */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Reads the server's base URL from an environment map.
 *
 * Exported and parameterised so the "unset" path is testable, mirroring
 * openai.ts's readApiKey.
 */
export function readBackgroundRemovalUrl(env: Record<string, string | undefined>): string | null {
  const url = env.EXPO_PUBLIC_BACKGROUND_REMOVAL_URL?.trim();
  if (!url) return null;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function baseUrl(): string | null {
  return readBackgroundRemovalUrl(process.env);
}

/** Whether a background-removal server is configured for this build. */
export function isBackgroundRemovalConfigured(): boolean {
  return baseUrl() !== null;
}

/**
 * Sends `sourceUri` (a JPEG) to the configured server and writes the returned
 * cutout PNG into the cache directory, returning its uri.
 *
 * Null when no server is configured, the request fails or times out, or the
 * server rejects the image — never throws.
 */
export async function removeBackground(sourceUri: string): Promise<string | null> {
  const url = baseUrl();
  if (url === null) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // A plain fetch body has to be a real Blob/ArrayBuffer that React
    // Native's native networking layer knows how to serialize -- an
    // expo-file-system File only *implements* the Blob interface in
    // TypeScript, so passing one directly as `body` sends its stringified
    // form instead of the file's bytes, and the server rejects it as an
    // unreadable image. FormData with a {uri, name, type} descriptor is the
    // native-file-upload path RN actually supports: the file is streamed
    // from disk on the native side, never read into JS memory here.
    const formData = new FormData();
    formData.append('image', {
      uri: sourceUri,
      name: 'photo.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);

    const response = await fetch(`${url}/v1/remove-background?output=cutout`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Background removal server responded ${response.status}`);
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const output = new File(Paths.cache, `cutout-${Date.now().toString(36)}.png`);
    output.write(bytes);
    return output.uri;
  } catch (e) {
    if (controller.signal.aborted) {
      console.warn('Background removal timed out');
    } else {
      console.warn('Background removal failed', e);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
