import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { imageUriFor } from '../services/images';
import { FramedImage } from './FramedImage';

/**
 * Renders a photo stored under the document directory, filling its parent.
 *
 * Takes the relative path straight off the row and resolves it here, so no
 * screen has to remember that the stored value is not directly renderable.
 */
export function StoredImage({
  path,
  placeholder,
  placeholderClassName = 'text-slate-500 text-xs',
  resizeMode = 'contain',
}: {
  path: string;
  placeholder: string;
  placeholderClassName?: string;
  /** 'contain' by default: a garment shown whole matters more than a filled tile. */
  resizeMode?: 'contain' | 'cover';
}) {
  const uri = imageUriFor(path);
  // A stored path whose file has gone missing used to render as an empty grey
  // box, which reads as a layout bug rather than as missing data. Falling back
  // to the placeholder says what actually happened.
  const [failed, setFailed] = useState(false);

  // Tiles are recycled as the grid scrolls, so a failure recorded for one item
  // must not stick to the next one shown in the same slot.
  //
  // Braced so the effect returns nothing: React reads an effect's return value
  // as a cleanup function, so an expression body here is one refactor away
  // from silently registering a cleanup that was never meant to exist.
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (!uri || failed) return <Text className={placeholderClassName}>{placeholder}</Text>;

  // A .png is a background-removal cutout, which background-framer already
  // crops to the garment and frames onto a margined canvas server-side (see
  // background-framer/frame.py) -- adding FramedImage's own margin on top
  // would double it. A .jpg is the plain photo (no cutout produced, or
  // background removal unset/failed), which still needs the display-time
  // margin, since nothing has framed it. Items saved before this split
  // existed may have an unframed .png from the old client-side crop; those
  // show with no margin until the photo is replaced or the item re-saved.
  const margin = path.endsWith('.png') ? 0 : undefined;

  return <FramedImage uri={uri} resizeMode={resizeMode} margin={margin} onError={() => setFailed(true)} />;
}
