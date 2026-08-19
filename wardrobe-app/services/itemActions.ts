import * as Crypto from 'expo-crypto';
import { deleteStoredImage, persistItemImage } from './images';
import { deleteItem, insertItem, updateItem, type ItemsDatabase, type NewClothingItem } from './items';
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
  persist(temporaryUri: string, itemId: string): string;
  /** Deletes a stored image. Best-effort: never throws. */
  remove(relativePath: string): void;
}

const deviceImages: ImageStore = {
  persist: persistItemImage,
  remove: deleteStoredImage,
};

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
}

/** The fields the add form collects. The photo and the identity are added here. */
export type ItemDraft = Omit<NewClothingItem, 'imagePath' | 'originalImagePath'>;

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
 * The file is written before the row, and removed again if the row fails. The
 * other order can leave a row pointing at a file that was never written, which
 * shows in the closet as a permanently broken tile; this order can at worst
 * leak a file nothing references, which is invisible and costs bytes.
 *
 * @throws whatever the filesystem or the insert threw, after cleaning up.
 */
export async function createItem(
  deps: ItemActionDeps,
  draft: ItemDraft,
  temporaryImageUri: string,
): Promise<ClothingItem> {
  const images = deps.images ?? deviceImages;
  const id = (deps.newId ?? Crypto.randomUUID)();
  const imagePath = images.persist(temporaryImageUri, id);

  try {
    return await deps.runQuery((db) =>
      insertItem(
        db,
        {
          ...draft,
          imagePath,
          // Identical until background removal exists, at which point the
          // processed file becomes imagePath and this still points at the
          // photo it was derived from.
          originalImagePath: imagePath,
        },
        id,
      ),
    );
  } catch (e) {
    removeImages(images, imagePath);
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
 * The new file lands at a new path, so the row is repointed rather than
 * rewritten in place, and the old files are removed only once the row no
 * longer refers to them. If the update fails, the row still points at the old
 * photo and it is the new file that is discarded.
 *
 * @throws if the row could not be updated, after discarding the new file.
 */
export async function replaceItemImage(
  deps: ItemActionDeps,
  item: ClothingItem,
  temporaryImageUri: string,
): Promise<void> {
  const images = deps.images ?? deviceImages;
  const imagePath = images.persist(temporaryImageUri, item.id);

  try {
    await deps.runQuery((db) =>
      updateItem(db, item.id, { imagePath, originalImagePath: imagePath }),
    );
  } catch (e) {
    removeImages(images, imagePath);
    throw e;
  }

  removeImages(images, item.imagePath, item.originalImagePath);
}
