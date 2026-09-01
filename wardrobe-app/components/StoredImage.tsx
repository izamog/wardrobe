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
  hasBakedMargin,
  placeholder,
  placeholderClassName = 'text-ink-muted text-xs font-sans',
  resizeMode = 'contain',
}: {
  path: string;
  /**
   * The item's own imageMarginBaked (types/wardrobe.ts) — whether path's
   * pixels already carry background-framer's baked margin. Omit only for a
   * pair member that isn't a real stored item (e.g. OutfitMatchScreen's ''
   * placeholder path), where there is nothing to look up; every real item
   * should pass its own field through rather than rely on the default.
   */
  hasBakedMargin?: boolean;
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

  // hasBakedMargin true means background-framer already cropped the garment
  // and framed it onto a margined canvas server-side (see
  // background-framer/frame.py) -- adding FramedImage's own margin on top
  // would double it. Anything else (a plain photo, or a cutout a manual crop
  // has since trimmed the baked margin off of — see imageMarginBaked's doc
  // comment in types/wardrobe.ts) still needs the display-time margin, since
  // nothing framed it, or nothing to trust framed it any more.
  const margin = hasBakedMargin ? 0 : undefined;

  return <FramedImage uri={uri} resizeMode={resizeMode} margin={margin} onError={() => setFailed(true)} />;
}
