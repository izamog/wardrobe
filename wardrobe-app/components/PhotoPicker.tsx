import React from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, Text, View } from 'react-native';
import { pickImage, prepareImage, type PickSource, type PreparedImage } from '../services/images';

/**
 * Explains a refused permission and offers the only thing that can fix it.
 *
 * A denied permission cannot be re-requested from inside the app once the user
 * has said no, so an alert saying "permission denied" and nothing else leaves
 * them stuck. Settings is the only route back.
 */
function explainPermissionDenied(source: PickSource) {
  const what = source === 'camera' ? 'the camera' : 'your photos';
  Alert.alert(
    'Permission needed',
    `Wardrobe needs access to ${what} to add a picture. You can turn it on in Settings.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
}

/**
 * Captures a photo and hands back a temporary file.
 *
 * The caller owns what happens to it — nothing here writes to permanent
 * storage, so backing out of the flow leaves only a cache file.
 */
export function usePhotoCapture(onPicked: (image: PreparedImage) => void) {
  const [busy, setBusy] = React.useState(false);

  const capture = React.useCallback(
    async (source: PickSource) => {
      setBusy(true);
      try {
        const picked = await pickImage(source);
        if (!picked.ok) {
          if (picked.reason === 'permission-denied') explainPermissionDenied(source);
          return;
        }
        onPicked(await prepareImage(picked.image));
      } catch (e) {
        console.error('Photo capture failed:', e);
        Alert.alert('Could not use that photo', 'Please try another one.');
      } finally {
        setBusy(false);
      }
    },
    [onPicked],
  );

  return { capture, busy };
}

function ChoiceButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-xl py-3.5 items-center bg-slate-900 mb-3"
    >
      <Text className="text-white font-semibold text-base">{label}</Text>
    </Pressable>
  );
}

/**
 * The capture step: choose a source.
 *
 * There is no way past this without a photo. A wardrobe entry the user cannot
 * see is close to useless — the closet, the matcher and the Phase 6 collages
 * are all pictures — so a photo is required rather than encouraged. Backing
 * out of the whole flow is still available through the modal's own dismiss.
 */
export function PhotoSourceChooser({ onPicked }: { onPicked: (image: PreparedImage) => void }) {
  const { capture, busy } = usePhotoCapture(onPicked);

  if (busy) {
    return (
      <View className="items-center py-10">
        <ActivityIndicator />
        <Text className="text-slate-500 mt-3">Finding the garment…</Text>
      </View>
    );
  }

  return (
    <View>
      <ChoiceButton label="Take a photo" onPress={() => void capture('camera')} />
      <ChoiceButton label="Choose from library" onPress={() => void capture('library')} />
    </View>
  );
}

/** The preview step: keep this photo, or go back and take another. */
export function PhotoPreview({
  uri,
  onAccept,
  onRetake,
}: {
  uri: string;
  onAccept: () => void;
  onRetake: () => void;
}) {
  return (
    <View>
      <View className="aspect-square rounded-2xl overflow-hidden bg-slate-200 mb-4">
        <Image source={{ uri }} className="w-full h-full" resizeMode="cover" />
      </View>
      <ChoiceButton label="Use this photo" onPress={onAccept} />
      <Pressable onPress={onRetake} accessibilityRole="button" className="py-3 items-center">
        <Text className="text-slate-500 font-medium">Take another</Text>
      </Pressable>
    </View>
  );
}
