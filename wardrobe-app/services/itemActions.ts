import * as Crypto from 'expo-crypto';
import { deleteStoredImage, persistItemImage } from './images';
import {
  deleteItem,
  insertItem,
  listExpiredArchivedItems,
  updateItem,
  type ItemsDatabase,
  type NewClothingItem,
} from './items';
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

/**
 * The fields the add form collects. The photo, the identity, and whether the
 * cutout came out with a baked margin are all decided here from the outcome
 * of background removal, not by the caller.
 */
export type ItemDraft = Omit<NewClothingItem, 'imagePath' | 'originalImagePath' | 'imageMarginBaked'>;

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
  const imageMarginBaked = cutoutUri !== null;

  try {
    return await deps.runQuery((db) =>
      insertItem(db, { ...draft, imagePath, originalImagePath, imageMarginBaked }, id),
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
 * Persists an already-edited image (a flip or a manual crop — see
 * flipStoredPhoto/cropStoredPhoto in services/images.ts) as the item's new
 * imagePath, and removes the old file once the row points at the new one.
 *
 * Deliberately narrower than replaceItemImage: those two edits work on the
 * photo already shown, not a fresh pick, so there is no new originalImagePath
 * and no background-removal attempt to make — only imagePath moves. New path,
 * not an overwrite, for the same image-cache reason persistItemImage's own
 * doc comment gives.
 *
 * `marginBaked` defaults to the item's current value, which is correct for a
 * flip: flipping preserves the whole canvas, margin included. A manual crop
 * is different — cropStoredPhoto trims the framed canvas's raw pixels by
 * arbitrary insets, which can (and often does) cut away the baked margin —
 * so ImageAdjustmentsScreen must pass `marginBaked: false` explicitly rather than rely on
 * this default. See imageMarginBaked's doc comment in types/wardrobe.ts.
 *
 * @throws if the row could not be updated, after discarding the new file.
 */
export async function editItemImage(
  deps: ItemActionDeps,
  item: ClothingItem,
  newUri: string,
  { marginBaked = item.imageMarginBaked }: { marginBaked?: boolean } = {},
): Promise<void> {
  const images = deps.images ?? deviceImages;
  const extension = item.imagePath.endsWith('.png') ? '.png' : '.jpg';
  const imagePath = images.persist(newUri, item.id, extension);

  try {
    await deps.runQuery((db) => updateItem(db, item.id, { imagePath, imageMarginBaked: marginBaked }));
  } catch (e) {
    removeImages(images, imagePath);
    throw e;
  }

  removeImages(images, item.imagePath);
}

/** How long a bulk-deleted item sits in the archive before it is permanently removed. */
export const ARCHIVE_RETENTION_DAYS = 30;

/**
 * Permanently removes every item whose archive grace period has passed —
 * the other half of the Closet's bulk-delete: archiveItems (services/items.ts)
 * only ever sets a timestamp, this is what actually deletes rows and files
 * once ARCHIVE_RETENTION_DAYS has elapsed.
 *
 * Called once at app startup (see App.tsx), not on a timer: a wardrobe app
 * only needs this to have run by the time the Archive screen or an outfit
 * search reads the database, not to fire the moment a retention period ends
 * while the app happens to be closed.
 *
 * Reuses removeItem per expired item rather than a bulk SQL delete, so each
 * one takes the same row-then-files ordering and the same file cleanup any
 * other deletion gets — see removeItem's own doc comment for why that order
 * matters. A failure partway (a locked db, a filesystem error) leaves the
 * remaining expired items to be swept on the next launch rather than losing
 * track of them.
 *
 * @returns how many items were purged.
 */
export async function purgeExpiredArchivedItems(
  deps: ItemActionDeps,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - ARCHIVE_RETENTION_DAYS);

  const expired = await deps.runQuery((db) => listExpiredArchivedItems(db, cutoff.toISOString()));
  // Each item's row-delete + file-removal is independent of every other's —
  // nothing here shares state across items, and a failure on one (already
  // logged and swallowed by removeItem's caller contract) must not block the
  // rest: a leftover item is simply swept again next launch. allSettled, not
  // Promise.all, so one rejection can't cut the sweep short.
  const results = await Promise.allSettled(expired.map((item) => removeItem(deps, item)));
  for (const result of results) {
    if (result.status === 'rejected') console.error('Failed to purge an expired archived item:', result.reason);
  }
  return expired.length;
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
  const imageMarginBaked = cutoutUri !== null;

  try {
    await deps.runQuery((db) =>
      updateItem(db, item.id, { imagePath, originalImagePath, imageMarginBaked }),
    );
  } catch (e) {
    removeImages(images, originalImagePath, imagePath);
    throw e;
  }

  removeImages(images, item.imagePath, item.originalImagePath);
}
