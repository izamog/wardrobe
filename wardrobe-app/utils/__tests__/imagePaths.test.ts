/** @jest-environment node */
import {
  ITEM_IMAGE_DIRECTORY,
  itemImageRelativePath,
  resolveImagePath,
} from '../imagePaths';

const DOC = 'file:///var/mobile/Containers/Data/Application/ABC-123/Documents/';

describe('itemImageRelativePath', () => {
  it('puts the file under the items directory, named for the item', () => {
    expect(itemImageRelativePath('abc', '.jpg')).toBe(`${ITEM_IMAGE_DIRECTORY}/abc.jpg`);
  });

  it('accepts an extension with or without the dot', () => {
    expect(itemImageRelativePath('abc', 'jpg')).toBe(itemImageRelativePath('abc', '.jpg'));
  });

  it('gives a variant its own file, so both can exist at once', () => {
    expect(itemImageRelativePath('abc', '.png', 'cutout')).toBe(
      `${ITEM_IMAGE_DIRECTORY}/abc-cutout.png`,
    );
    expect(itemImageRelativePath('abc', '.png', 'cutout')).not.toBe(
      itemImageRelativePath('abc', '.jpg'),
    );
  });

  it('never returns an absolute path', () => {
    expect(itemImageRelativePath('abc', '.jpg').startsWith('/')).toBe(false);
  });
});

describe('resolveImagePath', () => {
  it('joins the relative path onto the document directory', () => {
    expect(resolveImagePath(DOC, 'items/abc.jpg')).toBe(`${DOC}items/abc.jpg`);
  });

  it('tolerates a document directory without a trailing slash', () => {
    expect(resolveImagePath(DOC.slice(0, -1), 'items/abc.jpg')).toBe(`${DOC}items/abc.jpg`);
  });

  it('returns null for an item with no photo', () => {
    expect(resolveImagePath(DOC, '')).toBeNull();
  });

  it('resolves the same relative path against a changed container', () => {
    // The reason paths are stored relative: iOS reassigns the container UUID,
    // so yesterday's absolute URI is a dead link today.
    const moved = 'file:///var/mobile/Containers/Data/Application/XYZ-789/Documents/';
    expect(resolveImagePath(moved, 'items/abc.jpg')).toBe(`${moved}items/abc.jpg`);
  });

  it('refuses a path that would escape the document directory', () => {
    expect(resolveImagePath(DOC, '../../../etc/passwd')).toBeNull();
    expect(resolveImagePath(DOC, 'items/../../secrets.txt')).toBeNull();
  });

  it('refuses an absolute path or a full URI', () => {
    expect(resolveImagePath(DOC, '/etc/passwd')).toBeNull();
    expect(resolveImagePath(DOC, 'file:///etc/passwd')).toBeNull();
    expect(resolveImagePath(DOC, 'https://example.com/x.jpg')).toBeNull();
  });
});
