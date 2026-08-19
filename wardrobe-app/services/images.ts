import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { Category } from '../types/wardrobe';
import {
  ITEM_IMAGE_DIRECTORY,
  itemImageRelativePath,
  resolveImagePath,
} from '../utils/imagePaths';
import { resizeTargetFor } from '../utils/imageSizing';
import { cropRectFor, type CropRect } from '../utils/cropGeometry';
import { detectGarment } from './vision';

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
 * JPEG has no alpha channel — fine for camera photos, but when background
 * removal lands its output must be written as PNG or the cutout will silently
 * gain a solid background.
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
  /** A better crop, or null when detection found nothing to improve on. */
  uri: string | null;
  detectedCategory: Category | null;
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
  return { ok: true, image: { uri: asset.uri, width: asset.width, height: asset.height } };
}

/** Crops to `rect` when it is usable, resizes to the cap, and writes a JPEG to the cache. */
async function renderCrop(picked: PickedImage, rect: CropRect): Promise<string> {
  const context = ImageManipulator.ImageManipulator.manipulate(picked.uri);
  if (rect.width > 0 && rect.height > 0) context.crop(rect);

  // Sizing is measured against the cropped result, not the original: a crop
  // that already brought the garment under the cap must not then be enlarged.
  const target = resizeTargetFor(rect.width, rect.height);
  if (target) context.resize(target);

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    compress: IMAGE_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return saved.uri;
}

/**
 * Prepares a picked photo for immediate display, with no network call.
 *
 * Purely local, so it returns in the time a crop and a re-encode take rather
 * than the time a round trip to a vision model takes. The crop is the centred
 * fallback: a sensible 3:4 frame that refineCapturedImage then improves on
 * once it knows where the garment actually is.
 *
 * The output stays in the cache directory. Nothing is written to permanent
 * storage until the item is saved, so abandoning the flow leaves only a cache
 * file, which the system reclaims on its own.
 */
export async function prepareCapturedImage(picked: PickedImage): Promise<PreparedImage> {
  const uri = await renderCrop(picked, cropRectFor(null, picked.width, picked.height));
  return { uri, source: picked };
}

/**
 * Re-crops a photo around the garment, and reports what the garment looks like.
 *
 * Meant to run in the background while the user is describing the item, so the
 * wait for a vision model never sits between picking a photo and being able to
 * do anything. Crops from the original rather than from the fast version, so
 * nothing is lost to cropping twice.
 *
 * Never throws: refinement is an improvement on a usable image, not a step
 * that can fail the flow. A null uri means the fast crop should stand.
 */
export async function refineCapturedImage(picked: PickedImage): Promise<RefinedImage> {
  try {
    const detection = await detectGarment(picked.uri);
    if (detection.box === null) return { uri: null, detectedCategory: detection.category };

    const rect = cropRectFor(detection.box, picked.width, picked.height);
    return {
      uri: await renderCrop(picked, rect),
      detectedCategory: detection.category,
    };
  } catch (e) {
    console.warn('Could not refine the crop; keeping the centred one', e);
    return { uri: null, detectedCategory: null };
  }
}

function itemImageDirectory(): Directory {
  return new Directory(Paths.document, ITEM_IMAGE_DIRECTORY);
}

/**
 * Copies a prepared image into permanent storage under the item's id.
 *
 * Returns the *relative* path to store in the database — see
 * utils/imagePaths.ts for why an absolute one would rot.
 */
export function persistItemImage(temporaryUri: string, itemId: string): string {
  const directory = itemImageDirectory();
  directory.create({ intermediates: true, idempotent: true });

  // A fresh token per save, so replacing a photo produces a new URI. Writing
  // over the old path would leave React Native's image cache serving the
  // previous picture from an unchanged URI.
  const relativePath = itemImageRelativePath(
    itemId,
    IMAGE_EXTENSION,
    Date.now().toString(36),
  );
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
