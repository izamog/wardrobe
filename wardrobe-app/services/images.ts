import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import {
  ITEM_IMAGE_DIRECTORY,
  itemImageRelativePath,
  resolveImagePath,
} from '../utils/imagePaths';
import { resizeTargetFor } from '../utils/imageSizing';

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
    // Squares match the tile and detail layouts, and cropping at capture time
    // means the stored file is the shape that is actually displayed.
    allowsEditing: true,
    aspect: [1, 1],
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

/**
 * Downscales and re-encodes a picked photo, returning a new temporary file.
 *
 * The output stays in the cache directory. Nothing is written to permanent
 * storage until the item is actually saved, so abandoning the add flow leaves
 * only a cache file, which the system reclaims on its own.
 */
export async function prepareImage(picked: PickedImage): Promise<string> {
  const context = ImageManipulator.ImageManipulator.manipulate(picked.uri);

  // Skipped entirely for a photo already within the cap. resize() has no
  // "only if larger" mode, so calling it unconditionally scaled small images
  // up — more bytes, no more detail.
  const target = resizeTargetFor(picked.width, picked.height);
  if (target) context.resize(target);

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    compress: IMAGE_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return saved.uri;
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
