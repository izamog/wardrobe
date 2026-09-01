/**
 * Where an image lands inside a box under resizeMode="contain" — the same
 * placement React Native's own Image component computes internally, but
 * exposed here so the crop screen's overlay bars can be positioned against
 * the image's actual edges rather than the container's, which differ
 * whenever the image's aspect ratio doesn't match the box it's shown in.
 *
 * Pure and synchronous, so it's testable without a device.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangle an image of `imageWidth` x `imageHeight` occupies once
 * scaled to fit inside a `containerWidth` x `containerHeight` box without
 * cropping, centred on both axes.
 *
 * Returns a zero rectangle for any non-positive or non-finite dimension —
 * there is nothing meaningful to contain an image within (or to contain) at
 * a size of zero.
 */
export function containedRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): Rect {
  const dims = [containerWidth, containerHeight, imageWidth, imageHeight];
  if (dims.some((d) => !Number.isFinite(d) || d <= 0)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const containerRatio = containerWidth / containerHeight;
  const imageRatio = imageWidth / imageHeight;

  const width = imageRatio > containerRatio ? containerWidth : containerHeight * imageRatio;
  const height = imageRatio > containerRatio ? containerWidth / imageRatio : containerHeight;

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}
