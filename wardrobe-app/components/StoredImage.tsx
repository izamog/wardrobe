import React from 'react';
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

  if (!uri) return <Text className={placeholderClassName}>{placeholder}</Text>;

  return <Image source={{ uri }} className="w-full h-full" resizeMode="cover" />;
}
