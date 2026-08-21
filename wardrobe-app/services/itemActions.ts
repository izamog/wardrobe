import * as Crypto from 'expo-crypto';
import { deleteStoredImage, persistItemImage } from './images';
import { deleteItem, insertItem, updateItem, type ItemsDatabase, type NewClothingItem } from './items';
import { removeBackground } from './backgroundRemoval';
import type { ClothingItem } from '../types/wardrobe';

/**
 * Operations that touch both the database and the filesystem.
 *
 * They live together because the ordering between the two stores is the whole
 * problem: each of these can fail halfway, and which store is written first
 * decides what the user is left looking at.
 */

/** Runs a callback against the shared connection — services/database.ts's withDb. */
export type RunQuery = <T>(fn: (db: ItemsDatabase) => Promise<T>) => Promise<T>;

/** The filesystem side, narrowed to what these operations need. */
export interface ImageStore {
  /** Copies a temporary image into permanent storage; returns its relative path. */
  persist(temporaryUri: string, itemId: string, extension?: string): string;
  /** Deletes a stored image. Best-effort: never throws. */
  remove(relativePath: string): void;
}

const deviceImages: ImageStore = {
  persist: persistItemImage,
  remove: deleteStoredImage,
};

/** Attempts a background-removal cutout; null on any failure. Never throws. */
export type BackgroundRemover = (temporaryUri: string) => Promise<string | null>;

/**
 * The stores these operations act on.
 *
 * `runQuery` is required rather than defaulted because supplying it would mean
 * importing services/database.ts, and that pulls in expo-sqlite — which would
 * make this module, and so the ordering rules below, impossible to test off a
 * device. The other two default to the real thing.
 */
export interface ItemActionDeps {
  runQuery: RunQuery;
  images?: ImageStore;
  newId?: () => string;
  removeBackground?: BackgroundRemover;
}

/** The fields the add form collects. The photo and the identity are added here. */
export type ItemDraft = Omit<NewClothingItem, 'imagePath' | 'originalImagePath'>;

/**
 * The photo a create/replace call has to work with.
 *
 * `processed` distinguishes "a cutout was already attempted for this photo"
 * from "attempt one here": the add-item flow runs background removal live,
 * during refinement (see services/images.ts's refineCapturedImage), so by the
 * time it saves it already knows the outcome and passes it straight through
 * — omitting `processed` here would mean paying for that network call twice.
 * The item-details replace-photo flow has no such live step, so it leaves
 * `processed` unset and lets createItem/replaceItemImage attempt it here.
 *
 * - `undefined` (omitted): not attempted yet — attempt it now.
 * - `null`: already attempted and failed, or no server is configured —
 *   do not retry.
 * - a uri: already attempted and succeeded — persist it as-is.
 */
export interface ItemPhoto {
  /** The plain, unprocessed crop. Persisted as originalImagePath. */
  original: string;
  processed?: string | null;
}

/** Deletes each distinct, non-empty path exactly once. */
function removeImages(images: ImageStore, ...relativePaths: string[]): void {
  for (const path of new Set(relativePaths)) {
    if (path !== '') images.remove(path);
  }
}

/**
 * Saves a new item and its photo.
 *
 * A photo is required: the add flow has no path past the capture step without
 * one. Rows created before that rule, and rows whose file has gone missing,
 * still render a placeholder, but nothing new arrives without a picture.
 *
 * The original is written before the row, and both files are removed again if
 * the row fails. The other order can leave a row pointing at a file that was
 * never written, which shows in the closet as a permanently broken tile; this
 * order can at worst leak files nothing references, which is invisible and
 * costs bytes.
 *
 * A background-removal cutout is attempted (unless `photo.processed` already
 * says how that went — see ItemPhoto) and, when one is available, persisted
 * separately and used as imagePath; originalImagePath always stays the plain
 * photo, so a failed cutout is never worse than skipping this step.
 *
 * @throws whatever the filesystem or the insert threw, after cleaning up.
 */
export async function createItem(
  deps: ItemActionDeps,
  draft: ItemDraft,
  photo: ItemPhoto,
): Promise<ClothingItem> {
  const images = deps.images ?? deviceImages;
  const removeBg = deps.removeBackground ?? removeBackground;
  const id = (deps.newId ?? Crypto.randomUUID)();
  const originalImagePath = images.persist(photo.original, id);

  const cutoutUri = photo.processed !== undefined ? photo.processed : await removeBg(photo.original);
  const imagePath = cutoutUri ? images.persist(cutoutUri, id, '.png') : originalImagePath;

  try {
    return await deps.runQuery((db) =>
      insertItem(db, { ...draft, imagePath, originalImagePath }, id),
    );
  } catch (e) {
    removeImages(images, originalImagePath, imagePath);
    throw e;
  }
}

/**
 * Deletes an item, its photos, and (through the foreign key) its verdicts.
 *
 * Row first: once it is gone the item cannot be reached, so a failure to
 * delete the files leaves waste rather than anything the user can see. Doing
 * it the other way round would briefly show an item whose photo is missing.
 *
 * @throws if the row could not be deleted, in which case no file is touched.
 */
export async function removeItem(deps: ItemActionDeps, item: ClothingItem): Promise<void> {
  const images = deps.images ?? deviceImages;

  await deps.runQuery((db) => deleteItem(db, item.id));

  removeImages(images, item.imagePath, item.originalImagePath);
}

/**
 * Replaces an item's photo.
 *
 * The new files land at new paths, so the row is repointed rather than
 * rewritten in place, and the old files are removed only once the row no
 * longer refers to them. If the update fails, the row still points at the old
 * photo and it is the new files that are discarded.
 *
 * Attempts a background-removal cutout the same way createItem does — see
 * ItemPhoto and there for why a failed or already-known attempt falls back to
 * the plain photo rather than failing the save or retrying the network call.
 *
 * @throws if the row could not be updated, after discarding the new files.
 */
export async function replaceItemImage(
  deps: ItemActionDeps,
  item: ClothingItem,
  photo: ItemPhoto,
): Promise<void> {
  const images = deps.images ?? deviceImages;
  const removeBg = deps.removeBackground ?? removeBackground;
  const originalImagePath = images.persist(photo.original, item.id);

  const cutoutUri = photo.processed !== undefined ? photo.processed : await removeBg(photo.original);
  const imagePath = cutoutUri ? images.persist(cutoutUri, item.id, '.png') : originalImagePath;

  try {
    await deps.runQuery((db) => updateItem(db, item.id, { imagePath, originalImagePath }));
  } catch (e) {
    removeImages(images, originalImagePath, imagePath);
    throw e;
  }

  removeImages(images, item.imagePath, item.originalImagePath);
}
