import * as Crypto from 'expo-crypto';
import { withDb } from './database';
import { deleteItem, insertItem, updateItem, type NewClothingItem } from './items';
import { deleteStoredImage, persistItemImage } from './images';
import type { ClothingItem } from '../types/wardrobe';

/**
 * Operations that touch both the database and the filesystem.
 *
 * They live together because the ordering between the two stores is the whole
 * problem: each of these can fail halfway, and which store is written first
 * decides what the user is left looking at.
 */

/** The fields the add form collects. The photo and the identity are added here. */
export type ItemDraft = Omit<NewClothingItem, 'imagePath' | 'originalImagePath'>;

/**
 * Saves a new item and its photo.
 *
 * The file is written before the row, and removed again if the row fails. The
 * other order can leave a row pointing at a file that was never written, which
 * shows in the closet as a permanently broken tile; this order can at worst
 * leak a file nothing references, which is invisible and costs bytes.
 */
export async function createItem(
  draft: ItemDraft,
  temporaryImageUri: string | null,
): Promise<ClothingItem> {
  const id = Crypto.randomUUID();
  const imagePath = temporaryImageUri ? persistItemImage(temporaryImageUri, id) : '';

  try {
    return await withDb((db) =>
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
    deleteStoredImage(imagePath);
    throw e;
  }
}

/**
 * Deletes an item, its photos, and (through the foreign key) its verdicts.
 *
 * Row first: once it is gone the item cannot be reached, so a failure to
 * delete the files leaves waste rather than anything the user can see. Doing
 * it the other way round would briefly show an item whose photo is missing.
 */
export async function removeItem(item: ClothingItem): Promise<void> {
  await withDb((db) => deleteItem(db, item.id));

  deleteStoredImage(item.imagePath);
  if (item.originalImagePath !== item.imagePath) {
    deleteStoredImage(item.originalImagePath);
  }
}

/**
 * Replaces an item's photo.
 *
 * The new file lands at a new path, so the row is repointed rather than
 * rewritten in place, and the old file is removed only once the row no longer
 * refers to it. If the update fails, the row still points at the old photo and
 * it is the new file that is discarded.
 */
export async function replaceItemImage(
  item: ClothingItem,
  temporaryImageUri: string,
): Promise<void> {
  const imagePath = persistItemImage(temporaryImageUri, item.id);

  try {
    await withDb((db) => updateItem(db, item.id, { imagePath, originalImagePath: imagePath }));
  } catch (e) {
    deleteStoredImage(imagePath);
    throw e;
  }

  deleteStoredImage(item.imagePath);
  if (item.originalImagePath !== item.imagePath) {
    deleteStoredImage(item.originalImagePath);
  }
}
