import React, { useState } from 'react';
import { Image, View, type ImageResizeMode, type LayoutChangeEvent } from 'react-native';

/**
 * Fraction of the box reserved as margin on every side, regardless of the
 * image's own aspect ratio or how tightly the source photo happened to frame
 * the garment.
 *
 * A margin baked into the file can only ever come from real background
 * pixels the photo included around the garment -- a tightly-framed photo, or
 * one where the garment already fills the whole frame, has none to give (see
 * utils/cropGeometry.ts, which crops tight to the garment for exactly this
 * reason: it cannot manufacture a margin that isn't there). Reserving the
 * margin here instead, at display time, means it looks the same for every
 * garment no matter how it was photographed -- the appearance a photo editor
 * would call "letterboxing", added by layout rather than baked into pixels.
 *
 * Tuned to match the look of apps like Indyx, whose reference is roughly a
 * 30px margin on a photo-sized tile. Halved from an initial 0.12 -- that read
 * as too much margin, leaving the garment itself looking small in its tile.
 */
export const DISPLAY_MARGIN = 0.06;

/**
 * Renders `uri` centred in its parent, both horizontally and vertically,
 * with a consistent margin on every side.
 *
 * Centring is plain flexbox (alignItems/justifyContent: center on the
 * parent), which is what actually guarantees it regardless of the image's
 * own aspect ratio -- resizeMode="contain" alone centres the image within
 * whatever box it's given, but a box that isn't itself centred in its parent
 * would still show an off-centre result.
 *
 * The margin is sized from this component's own measured layout rather than
 * percentage padding: React Native (like CSS) resolves percentage padding
 * against the parent's *width* for every side, including top and bottom,
 * which would make the vertical margin wrong on any box that isn't square.
 * Measuring the actual rendered width and height and computing the margin
 * from each directly is what keeps it looking proportionate on a 3:4 tile, a
 * square one, or anything else a screen wraps this in.
 */
export function FramedImage({
  uri,
  resizeMode = 'contain',
  margin = DISPLAY_MARGIN,
  onError,
}: {
  uri: string;
  resizeMode?: ImageResizeMode;
  margin?: number;
  onError?: () => void;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  }

  return (
    <View className="w-full h-full items-center justify-center" onLayout={onLayout}>
      {box ? (
        <Image
          source={{ uri }}
          style={{
            width: box.width * (1 - margin * 2),
            height: box.height * (1 - margin * 2),
          }}
          resizeMode={resizeMode}
          onError={onError}
        />
      ) : null}
    </View>
  );
}
