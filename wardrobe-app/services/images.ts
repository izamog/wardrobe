import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { Category, GarmentLength, SleeveLength } from '../types/wardrobe';
import {
  ITEM_IMAGE_DIRECTORY,
  itemImageRelativePath,
  resolveImagePath,
} from '../utils/imagePaths';
import { resizeTargetFor } from '../utils/imageSizing';
import { cropRectFor, type CropRect } from '../utils/cropGeometry';
import { detectGarment } from './vision';
import { removeBackground } from './backgroundRemoval';

/**
 * The one module that touches the camera, the photo library and the disk.
 *
 * Path arithmetic lives in utils/imagePaths.ts, which is pure and tested. What
 * is left here is native calls only, and it is not unit-testable off-device —
 * everything in this file has to be verified by running the app.
 */

/**
 * JPEG quality for stored photos, 0-1.
 *
 * 0.8 is the usual knee of the quality/size curve for photographs. Note that
 * JPEG has no alpha channel — fine for camera photos, but a background-removal
 * cutout must be persisted with the .png extension (see persistItemImage) or
 * it silently gains a solid background.
 */
const IMAGE_QUALITY = 0.8;

const IMAGE_EXTENSION = '.jpg';

export type PickSource = 'camera' | 'library';

/** Why a pick produced no image, so the caller can say something specific. */
export type PickFailure = 'cancelled' | 'permission-denied';

/** A picked photo, with the dimensions the resize step needs. */
export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

export type PickResult = { ok: true; image: PickedImage } | { ok: false; reason: PickFailure };

/** A photo ready to show and store, plus the original it came from. */
export interface PreparedImage {
  uri: string;
  /** Kept so refinement can re-crop from the full-resolution original later. */
  source: PickedImage;
}

/** What a background refinement pass worked out, once it finishes. */
export interface RefinedImage {
  /** A tighter, box-based re-crop of the plain photo. Null only when the refinement pass itself failed outright, in which case the fast centred crop already on screen should stand. */
  uri: string | null;
  /**
   * The same crop, background removed, when a server was configured and the
   * attempt succeeded. Deliberately null (not undefined) rather than omitted
   * when refinement ran but produced no cutout — itemActions.ts uses that
   * distinction to tell "already tried, nothing to show" apart from "never
   * tried yet" and so avoid attempting the network call a second time.
   */
  cutoutUri: string | null;
  detectedCategory: Category | null;
  detectedSleeveLength: SleeveLength | null;
  detectedLength: GarmentLength | null;
  detectedHasBeltLoops: boolean | null;
}

/**
 * Re-encodes a freshly picked photo once, immediately, and trusts the
 * dimensions the encoder reports back rather than the picker's own
 * asset.width/height.
 *
 * Works around a known expo-image-manipulator/EXIF issue (expo/expo#2329,
 * expo/expo#2512): a photo carrying EXIF orientation metadata -- routine for
 * a portrait photo straight off the camera -- can be handled inconsistently
 * across separate manipulate() calls, with different calls disagreeing about
 * which axis is width and which is height. Every later step in this file
 * (the fast centred crop, the vision detection resize, the refined crop) is
 * its own independent manipulate() call and works in fractions of a single
 * (width, height) pair; if even one of those three calls resolves
 * orientation differently from the others, a detected box's fractions land
 * on the wrong axis entirely -- symptomatically, a wide garment loses its
 * sides and a tall one loses its top, exactly like a 90-degree mix-up, and
 * unrelated to how much contrast the garment has against the background.
 * Running one identity render+save here, before anything else touches the
 * file, resolves orientation exactly once and hands every downstream step
 * the same already-normalized image and the width/height the encoder itself
 * measured off it, rather than three independent chances to disagree.
 */
async function normalizeOrientation(picked: PickedImage): Promise<PickedImage> {
  const context = ImageManipulator.ImageManipulator.manipulate(picked.uri);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: IMAGE_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * Asks for a photo from the camera or the library.
 *
 * Permission denial is a normal outcome, not an exception: it is reported in
 * the result so the caller can offer the Settings app rather than showing a
 * failure the user cannot act on.
 */
export async function pickImage(source: PickSource): Promise<PickResult> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) return { ok: false, reason: 'permission-denied' };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // No manual crop step: the garment is found and cropped to automatically
    // after picking, and making the user drag a box first would be asking them
    // to do the work twice.
    allowsEditing: false,
    quality: 1,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || result.assets.length === 0) return { ok: false, reason: 'cancelled' };

  const asset = result.assets[0];
  const image = await normalizeOrientation({ uri: asset.uri, width: asset.width, height: asset.height });
  return { ok: true, image };
}

/**
 * Crops `sourceUri` to `rect` when it is usable, resizes to the cap, and
 * writes it to the cache.
 *
 * `format` defaults to JPEG for plain photos; a background-removal cutout
 * must be cropped as PNG instead, or its transparency is lost the moment this
 * re-encodes it.
 */
async function renderCrop(
  sourceUri: string,
  rect: CropRect,
  format: ImageManipulator.SaveFormat = ImageManipulator.SaveFormat.JPEG,
): Promise<string> {
  const context = ImageManipulator.ImageManipulator.manipulate(sourceUri);
  if (rect.width > 0 && rect.height > 0) context.crop(rect);

  // Sizing is measured against the cropped result, not the original: a crop
  // that already brought the garment under the cap must not then be enlarged.
  const target = resizeTargetFor(rect.width, rect.height);
  if (target) context.resize(target);

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    compress: IMAGE_QUALITY,
    format,
  });
  return saved.uri;
}

/**
 * Resizes `sourceUri` down to the size cap if it is over it, without
 * cropping. Used for the background-removal cutout, which arrives already
 * cropped to the garment and framed onto a margined canvas by the server
 * (see background-framer/frame.py) -- cropping it again here with a
 * separately-guessed rectangle would undo that precision, so this only ever
 * scales, never cuts.
 *
 * Needs the source's own dimensions to decide whether (and how) to resize
 * without enlarging an already-small image, which an image-manipulator
 * context only reports after a render -- hence the two-step render, same
 * technique normalizeOrientation uses.
 */
async function capImageSize(sourceUri: string): Promise<string> {
  const probe = await ImageManipulator.ImageManipulator.manipulate(sourceUri).renderAsync();
  const target = resizeTargetFor(probe.width, probe.height);
  if (!target) {
    const saved = await probe.saveAsync({ format: ImageManipulator.SaveFormat.PNG });
    return saved.uri;
  }

  const context = ImageManipulator.ImageManipulator.manipulate(sourceUri);
  context.resize(target);
  const resized = await context.renderAsync();
  const saved = await resized.saveAsync({ format: ImageManipulator.SaveFormat.PNG });
  return saved.uri;
}

/**
 * Prepares a picked photo for immediate display, with no network call.
 *
 * Purely local, so it returns in the time a re-encode takes rather than the
 * time a round trip to a vision model takes. With no garment location known
 * yet, this is the whole photo, untouched -- see cropGeometry.ts's
 * cropRectFor(null, ...) -- which refineCapturedImage then narrows down once
 * it knows where the garment actually is. The display layer (see
 * components/FramedImage.tsx) letterboxes whatever shape this ends up being
 * just as well as the eventual tight crop, so there is nothing wrong to look
 * at in between.
 *
 * The output stays in the cache directory. Nothing is written to permanent
 * storage until the item is saved, so abandoning the flow leaves only a cache
 * file, which the system reclaims on its own.
 */
export async function prepareCapturedImage(picked: PickedImage): Promise<PreparedImage> {
  const uri = await renderCrop(picked.uri, cropRectFor(null, picked.width, picked.height));
  return { uri, source: picked };
}

/**
 * Removes the background and re-crops the plain photo around the garment,
 * and reports what the garment looks like.
 *
 * Meant to run in the background while the user is describing the item, so
 * neither the round trip to a vision model nor the one to the background-
 * removal server sits between picking a photo and being able to do anything.
 * Both run concurrently against the same original photo, since neither
 * depends on the other's result.
 *
 * The cutout is used as the background-removal server returns it, not
 * re-cropped against the vision model's box the way the plain photo is: the
 * server already crops it to the exact bounding box of its own alpha
 * channel and frames it onto a margined canvas (see
 * background-framer/frame.py), which is both more precise and immune to the
 * vision box being wrong in a way a client-side re-crop is not — see
 * utils/cropGeometry.ts for that box's own margin of error. Cropping the
 * cutout again here with the same fallible box would throw that precision
 * away, so it only gets resized down for storage (capImageSize), never
 * cropped.
 *
 * Never throws: refinement is an improvement on a usable image, not a step
 * that can fail the flow. A null uri means the fast crop should stand.
 */
export async function refineCapturedImage(picked: PickedImage): Promise<RefinedImage> {
  try {
    const [detection, cutoutSourceUri] = await Promise.all([
      detectGarment(picked.uri),
      removeBackground(picked.uri),
    ]);

    const rect = cropRectFor(detection.box, picked.width, picked.height);
    const uri = await renderCrop(picked.uri, rect);
    const cutoutUri = cutoutSourceUri ? await capImageSize(cutoutSourceUri) : null;

    return {
      uri,
      cutoutUri,
      detectedCategory: detection.category,
      detectedSleeveLength: detection.sleeveLength,
      detectedLength: detection.length,
      detectedHasBeltLoops: detection.hasBeltLoops,
    };
  } catch (e) {
    console.warn('Could not refine the crop; keeping the centred one', e);
    return {
      uri: null,
      cutoutUri: null,
      detectedCategory: null,
      detectedSleeveLength: null,
      detectedLength: null,
      detectedHasBeltLoops: null,
    };
  }
}

function itemImageDirectory(): Directory {
  return new Directory(Paths.document, ITEM_IMAGE_DIRECTORY);
}

/**
 * Copies a prepared image into permanent storage under the item's id.
 *
 * `extension` defaults to the plain-photo JPEG; pass '.png' to persist a
 * background-removal cutout instead — its own file, not an overwrite, since
 * imagePath and originalImagePath can point at either one independently.
 *
 * Returns the *relative* path to store in the database — see
 * utils/imagePaths.ts for why an absolute one would rot.
 */
export function persistItemImage(
  temporaryUri: string,
  itemId: string,
  extension: string = IMAGE_EXTENSION,
): string {
  const directory = itemImageDirectory();
  directory.create({ intermediates: true, idempotent: true });

  // A fresh token per save, so replacing a photo produces a new URI. Writing
  // over the old path would leave React Native's image cache serving the
  // previous picture from an unchanged URI.
  const relativePath = itemImageRelativePath(itemId, extension, Date.now().toString(36));
  new File(temporaryUri).copy(new File(Paths.document, relativePath));

  return relativePath;
}

/**
 * Deletes a stored image, tolerating its absence.
 *
 * Best-effort by design: this runs after the database row is already gone, and
 * a file that cannot be deleted is invisible wasted bytes. Failing loudly here
 * would report an error for an operation that, as far as the user is
 * concerned, succeeded.
 */
export function deleteStoredImage(relativePath: string): void {
  if (relativePath === '') return;
  try {
    const file = new File(Paths.document, relativePath);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('Could not delete image', relativePath, e);
  }
}

/**
 * The document directory URI, read once.
 *
 * Stable for the lifetime of the process, and imageUriFor() is called for
 * every tile on every render of the closet grid — no reason to cross into
 * native code each time.
 */
let documentDirectoryUri: string | null = null;

/** Absolute URI for rendering a stored image, or null when there is no photo. */
export function imageUriFor(relativePath: string): string | null {
  documentDirectoryUri ??= Paths.document.uri;
  return resolveImagePath(documentDirectoryUri, relativePath);
}
