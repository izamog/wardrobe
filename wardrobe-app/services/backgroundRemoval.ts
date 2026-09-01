import { File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { resizeTargetFor } from '../utils/imageSizing';
import { probeImageDimensions } from './imageProbe';

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

/**
 * Reads the shared-secret bearer token from an environment map, if the
 * server was configured to require one (see background-framer/app.py's
 * FRAMER_AUTH_TOKEN). Absent by default — fine while the server only
 * answers on a LAN/Tailscale address, same trust model readBackgroundRemovalUrl
 * documents in .env.example.
 *
 * SECURITY: like EXPO_PUBLIC_OPENAI_API_KEY, this is inlined into the JS
 * bundle in plain text and can be extracted from any build of the app —
 * acceptable only because it gates a personal LAN/Tailscale-only service on
 * a build only the developer runs. Do not treat this as real authentication
 * once the app is distributed to anyone else: it has to move to a per-device
 * credential issued by a trusted service before then, the same move
 * EXPO_PUBLIC_OPENAI_API_KEY is already documented as needing.
 */
export function readBackgroundRemovalToken(env: Record<string, string | undefined>): string | null {
  const token = env.EXPO_PUBLIC_BACKGROUND_REMOVAL_TOKEN?.trim();
  return token ? token : null;
}

function baseUrl(): string | null {
  return readBackgroundRemovalUrl(process.env);
}

function authToken(): string | null {
  return readBackgroundRemovalToken(process.env);
}

/** Whether a background-removal server is configured for this build. */
export function isBackgroundRemovalConfigured(): boolean {
  return baseUrl() !== null;
}

/**
 * Downscales `sourceUri` to the stored-image cap before it ever leaves the
 * device, matching what images.ts's capImageSize enforces on the cutout
 * coming back. A full 12MP camera photo has no benefit over one already at
 * MAX_IMAGE_DIMENSION here: the returned cutout gets capped to that same
 * limit on the way back in regardless, so uploading it uncapped only spends
 * bandwidth and server-side memory for detail that is thrown away one step
 * later. If MAX_IMAGE_DIMENSION is ever raised to suit a larger display (an
 * iPad), this scales with it automatically rather than needing its own,
 * separately-tuned cap.
 *
 * Returns `sourceUri` unchanged when it is already under the cap.
 */
async function capForUpload(sourceUri: string): Promise<string> {
  const { width, height } = await probeImageDimensions(sourceUri);
  const target = resizeTargetFor(width, height);
  if (!target) return sourceUri;

  const context = ImageManipulator.ImageManipulator.manipulate(sourceUri);
  context.resize(target);
  const resized = await context.renderAsync();
  const saved = await resized.saveAsync({ compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
  return saved.uri;
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
    const uploadUri = await capForUpload(sourceUri);

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
      uri: uploadUri,
      name: 'photo.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);

    const token = authToken();
    const response = await fetch(`${url}/v1/remove-background?output=cutout`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
