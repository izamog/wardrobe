import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { BottomBar } from '../components/BottomBar';
import { EmptyState } from '../components/EmptyState';
import { ItemPhotoBackdrop } from '../components/ItemPhotoBackdrop';
import { PrimaryButton } from '../components/Form';
import { containedRect, type Rect } from '../utils/containedRect';
import { MAX_INSET, type EdgeInsets } from '../utils/cropGeometry';
import type { RootStackParamList } from '../navigation/types';
import { usePhotoAdjustments } from './imageAdjustmentsHooks';

/**
 * Every edit that acts on an item's stored photo pixels, consolidated onto
 * one screen: flip, rotate and manually trimming the edges (crop).
 *
 * Every one of them is staged locally — none of it touches the database
 * until "Save adjustments" is pressed, and leaving the screen any other way
 * (the header's back gesture/button) discards all of it, flip and rotate
 * included. An earlier version of this screen applied flip/rotate
 * immediately, on the reasoning that there's nothing to preview or
 * reconsider about mirroring or squaring up a photo — reported bug: that
 * meant navigating away without pressing anything still permanently changed
 * the item's photo, which is exactly the "did I actually save that"
 * confusion a staged, single Save is supposed to prevent. The temporary
 * files each flip/rotate/crop step produces along the way (see
 * flipStoredPhoto/rotateStoredPhoto/cropStoredPhoto in services/images.ts)
 * live in the cache directory and are never written to permanent storage
 * unless Save actually runs — abandoning the screen leaves nothing for a
 * caller to clean up, the same guarantee prepareCapturedImage's own doc
 * comment describes for the add-item flow.
 *
 * The overlay bars are a preview only: they're sized against the image's
 * displayed rect (see containedRect) purely for visual feedback while
 * dragging. The actual crop, computed by cropStoredPhoto against the image's
 * real pixel dimensions when Save is pressed, is exact regardless of how
 * accurately the preview rendered.
 */

const OVERLAY_COLOR = 'rgba(26, 23, 20, 0.55)';

/** One overlay bar, absolutely positioned within the (already-positioned) preview. */
function OverlayBar({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left, top, width, height, backgroundColor: OVERLAY_COLOR }}
    />
  );
}

/** The four semi-transparent bars showing what each slider would trim away. */
function InsetOverlay({ imageRect, insets }: { imageRect: Rect; insets: EdgeInsets }) {
  const top = insets.top * imageRect.height;
  const bottom = insets.bottom * imageRect.height;
  const left = insets.left * imageRect.width;
  const right = insets.right * imageRect.width;
  const middleHeight = imageRect.height - top - bottom;

  return (
    <>
      <OverlayBar left={imageRect.x} top={imageRect.y} width={imageRect.width} height={top} />
      <OverlayBar
        left={imageRect.x}
        top={imageRect.y + imageRect.height - bottom}
        width={imageRect.width}
        height={bottom}
      />
      <OverlayBar left={imageRect.x} top={imageRect.y + top} width={left} height={middleHeight} />
      <OverlayBar
        left={imageRect.x + imageRect.width - right}
        top={imageRect.y + top}
        width={right}
        height={middleHeight}
      />
    </>
  );
}

/**
 * The photo, sized and positioned via containedRect so InsetOverlay can
 * align to its true edges.
 *
 * Must stretch to fill its parent (`flex-1`, no `alignItems`/`justifyContent`
 * on that parent) — reported bug: centring the parent instead made this
 * View's own cross-axis size collapse to its content's intrinsic size
 * (React Native flexbox's `alignItems: center` overrides the default
 * `stretch`), which for a View whose only children are absolutely
 * positioned is 0. onLayout then reported a 0-width container, imageRect
 * came out null, and nothing ever rendered — a black screen where the photo
 * should have been. Center the loading/empty states individually instead of
 * centring the shared parent this sits in.
 */
function CropPreview({ uri, insets }: { uri: string; insets: EdgeInsets }) {
  const [container, setContainer] = useState<{ width: number; height: number } | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    Image.getSize(
      uri,
      (width, height) => setNatural({ width, height }),
      (e) => console.warn('Could not read image size for the crop preview', e),
    );
  }, [uri]);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ width, height });
  }

  const imageRect =
    container && natural
      ? containedRect(container.width, container.height, natural.width, natural.height)
      : null;

  return (
    <View className="flex-1" onLayout={onLayout}>
      {imageRect && imageRect.width > 0 && (
        <>
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={{
              position: 'absolute',
              left: imageRect.x,
              top: imageRect.y,
              width: imageRect.width,
              height: imageRect.height,
            }}
          />
          <InsetOverlay imageRect={imageRect} insets={insets} />
        </>
      )}
    </View>
  );
}

/** One of the Flip horizontal/vertical or Rotate buttons. */
function TransformButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`flex-1 flex-row items-center justify-center rounded-sm border py-3.5 mx-1 ${
        disabled ? 'border-rule bg-paper-2' : 'border-rule bg-paper'
      }`}
    >
      <Ionicons name={icon} size={16} color={disabled ? '#6B6259' : '#1A1714'} />
      <Text className={`text-sm font-sans-medium ml-1.5 ${disabled ? 'text-ink-muted/50' : 'text-ink-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function InsetSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <View className="mb-3">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-xs font-sans text-ink-muted">{label}</Text>
        <Text className="text-xs font-sans-medium text-ink-muted">{Math.round(value * 100)}%</Text>
      </View>
      <Slider
        minimumValue={0}
        maximumValue={MAX_INSET}
        step={0.01}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor="#1A1714"
      />
    </View>
  );
}

export function ImageAdjustmentsScreen() {
  const { itemId } = useRoute<RouteProp<RootStackParamList, 'ImageAdjustments'>>().params;
  const {
    item,
    error,
    loading,
    previewUri,
    insets,
    setInsets,
    dirty,
    busy,
    saving,
    handleFlip,
    handleRotate,
    handleReset,
    handleSave,
  } = usePhotoAdjustments(itemId);

  if (error) return <EmptyState title={error} />;
  if (loading && !item) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }
  if (!item) return <EmptyState title="This item no longer exists." />;

  return (
    <View className="flex-1 bg-paper">
      <View className="flex-1">
        <ItemPhotoBackdrop />
        {busy ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : previewUri ? (
          <CropPreview uri={previewUri} insets={insets} />
        ) : (
          <View className="flex-1 items-center justify-center">
            <EmptyState title="No photo to adjust" />
          </View>
        )}
      </View>

      <View className="px-5 pt-3 bg-paper">
        <View className="flex-row -mx-1">
          <TransformButton
            label="Flip horizontal"
            icon="swap-horizontal-outline"
            onPress={() => handleFlip('horizontal')}
            disabled={busy}
          />
          <TransformButton
            label="Flip vertical"
            icon="swap-vertical-outline"
            onPress={() => handleFlip('vertical')}
            disabled={busy}
          />
          <TransformButton label="Rotate" icon="reload-outline" onPress={handleRotate} disabled={busy} />
        </View>
      </View>

      <View className="px-5 pt-3 pb-28 bg-paper">
        <InsetSlider label="Top" value={insets.top} onChange={(v) => setInsets({ ...insets, top: v })} />
        <InsetSlider label="Bottom" value={insets.bottom} onChange={(v) => setInsets({ ...insets, bottom: v })} />
        <InsetSlider label="Left" value={insets.left} onChange={(v) => setInsets({ ...insets, left: v })} />
        <InsetSlider label="Right" value={insets.right} onChange={(v) => setInsets({ ...insets, right: v })} />
      </View>

      <BottomBar>
        <View className="flex-row">
          <View className="flex-1 mr-2">
            <PrimaryButton label="Reset" tone="secondary" onPress={handleReset} disabled={!dirty || busy} />
          </View>
          <View className="flex-1 ml-2">
            <PrimaryButton
              label={saving ? 'Saving…' : 'Save adjustments'}
              onPress={() => void handleSave()}
              disabled={!dirty || busy}
            />
          </View>
        </View>
      </BottomBar>
    </View>
  );
}
