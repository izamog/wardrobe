/** Sub-directory of the app's document directory where item photos live. */
export const ITEM_IMAGE_DIRECTORY = 'items';

/**
 * The relative path at which an item's photo is stored.
 *
 * Named after the item id so a file can always be traced back to its row.
 *
 * `variant` distinguishes files belonging to the same item, and callers should
 * pass a fresh one whenever they replace a photo. Reusing a path would leave
 * the URI unchanged while the bytes behind it changed, and React Native's
 * image cache is keyed on the URI — the old picture would keep rendering. It
 * is also how a background-removed version will sit alongside its original.
 */
export function itemImageRelativePath(
  itemId: string,
  extension: string,
  variant?: string,
): string {
  const suffix = variant ? `-${variant}` : '';
  const dot = extension.startsWith('.') ? extension : `.${extension}`;
  return `${ITEM_IMAGE_DIRECTORY}/${itemId}${suffix}${dot}`;
}

/**
 * Turns a stored relative path into an absolute file URI for rendering.
 *
 * Returns null when there is no photo, so callers get one unambiguous "nothing
 * to show" value instead of an empty string that renders as a broken image.
 *
 * Rejects anything that is not a plain relative path. Today every stored path
 * comes from itemImageRelativePath() and cannot be hostile, but a value that
 * escaped the document directory would read files outside the app's sandbox,
 * and the check costs nothing.
 */
export function resolveImagePath(
  documentDirectoryUri: string,
  relativePath: string,
): string | null {
  if (relativePath === '') return null;
  if (relativePath.startsWith('/') || relativePath.includes('://')) return null;
  if (relativePath.split('/').includes('..')) return null;

  const base = documentDirectoryUri.endsWith('/')
    ? documentDirectoryUri
    : `${documentDirectoryUri}/`;
  return `${base}${relativePath}`;
}
