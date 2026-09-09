import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Renders `sourceUri` once purely to learn its real pixel dimensions.
 *
 * An image-manipulator context only reports width/height after a render, so
 * every caller that needs to size or crop against the source's actual
 * dimensions (not the picker's possibly-stale reported size) goes through
 * this same probe rather than each repeating the render.
 *
 * Lives in its own module rather than services/images.ts or
 * services/backgroundRemoval.ts: images.ts already imports from
 * backgroundRemoval.ts (for removeBackground), so backgroundRemoval.ts
 * importing back from images.ts for this would be circular.
 *
 * Not used by images.ts's capImageSize, which has its own two-step render —
 * that one deliberately reuses the *probe object itself* to save the result
 * when no resize is needed, avoiding a second render in the common case.
 * Discarding the probe object here (keeping only width/height) is right for
 * every other caller, which always opens a fresh context afterward anyway.
 */
export async function probeImageDimensions(sourceUri: string): Promise<{ width: number; height: number }> {
  const probe = await ImageManipulator.ImageManipulator.manipulate(sourceUri).renderAsync();
  return { width: probe.width, height: probe.height };
}
