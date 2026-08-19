import React, { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';
import { imageUriFor } from '../services/images';

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
}: {
  path: string;
  placeholder: string;
  placeholderClassName?: string;
}) {
  const uri = imageUriFor(path);
  // A stored path whose file has gone missing used to render as an empty grey
  // box, which reads as a layout bug rather than as missing data. Falling back
  // to the placeholder says what actually happened.
  const [failed, setFailed] = useState(false);

  // Tiles are recycled as the grid scrolls, so a failure recorded for one item
  // must not stick to the next one shown in the same slot.
  useEffect(() => setFailed(false), [uri]);

  if (!uri || failed) return <Text className={placeholderClassName}>{placeholder}</Text>;

  return (
    <Image
      source={{ uri }}
      className="w-full h-full"
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}
