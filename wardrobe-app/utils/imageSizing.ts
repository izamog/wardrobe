/**
 * Longest edge of a stored photo, in pixels.
 *
 * A modern phone camera produces 12MP images of ~4MB. Storing those unchanged
 * would put a gigabyte in the document directory for a few hundred garments,
 * for a picture never shown larger than a phone screen. 1500px is generous for
 * a full-screen view on a 3x display and roughly a tenth of the bytes.
 */
export const MAX_IMAGE_DIMENSION = 1500;

/** What to pass to the image manipulator, or null when the photo is already small enough. */
export type ResizeTarget = { width: number } | { height: number } | null;

/**
 * Decides how to bring a photo within the size cap, preserving aspect ratio.
 *
 * Constrains whichever edge is longer, because constraining width alone leaves
 * a portrait photo taller than the cap — and, worse, *enlarges* an image that
 * was already small, spending bytes to invent detail that is not there.
 *
 * Unusable dimensions fall back to capping the width. Nothing downstream
 * validates the picker's metadata, so the safe failure is a bounded image
 * rather than an unbounded one.
 */
export function resizeTargetFor(
  width: number,
  height: number,
  max: number = MAX_IMAGE_DIMENSION,
): ResizeTarget {
  const usable =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  if (!usable) return { width: max };

  if (Math.max(width, height) <= max) return null;

  return width >= height ? { width: max } : { height: max };
}
