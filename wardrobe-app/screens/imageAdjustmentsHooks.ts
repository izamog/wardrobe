import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDbQuery } from '../hooks/useDbQuery';
import { getItem } from '../services/items';
import { editItemImage } from '../services/itemActions';
import { cropStoredPhoto, flipStoredPhoto, imageUriFor, rotateStoredPhoto } from '../services/images';
import { withDb } from '../services/database';
import { NO_INSETS, type EdgeInsets } from '../utils/cropGeometry';
import type { RootStackParamList } from '../navigation/types';

/** Whether every inset is 0 — no crop selected. */
export function isNoOpInsets(insets: EdgeInsets): boolean {
  return insets.top === 0 && insets.bottom === 0 && insets.left === 0 && insets.right === 0;
}

/**
 * Every pixel edit staged for ImageAdjustmentsScreen's photo, and the single
 * point that commits them together — see that screen's own module doc
 * comment for why nothing here touches the database before Save.
 *
 * `workingUri` starts null, meaning "nothing staged yet, preview
 * sourceUri" — set the moment a flip or rotate is applied, and every
 * subsequent transform (including crop, at Save time) chains off it rather
 * than sourceUri, so repeated edits compose instead of each one discarding
 * the last.
 */
export function usePhotoAdjustments(itemId: string) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: item, error, loading } = useDbQuery((db) => getItem(db, itemId), [itemId]);
  const sourceUri = item ? imageUriFor(item.imagePath) : null;

  const [workingUri, setWorkingUri] = useState<string | null>(null);
  const [insets, setInsets] = useState<EdgeInsets>(NO_INSETS);
  const [transforming, setTransforming] = useState(false);
  const [saving, setSaving] = useState(false);

  const previewUri = workingUri ?? sourceUri;
  const dirty = workingUri !== null || !isNoOpInsets(insets);
  const busy = transforming || saving;

  async function applyTransform(produce: (uri: string) => Promise<string>, failureMessage: string) {
    if (!previewUri) return;
    setTransforming(true);
    try {
      setWorkingUri(await produce(previewUri));
      // A flip or rotate changes the photo's own orientation under whatever
      // fractional selection the crop sliders were mid-way through — keeping
      // it would still apply *somewhere* on the transformed photo, just not
      // anywhere the user actually chose, which is more likely to confuse
      // than to still mean what they intended.
      setInsets(NO_INSETS);
    } catch (e) {
      console.error(failureMessage, e);
      Alert.alert('Could not apply the change', 'Try again.');
    } finally {
      setTransforming(false);
    }
  }

  const handleFlip = (axis: 'horizontal' | 'vertical') =>
    void applyTransform((uri) => flipStoredPhoto(uri, axis), 'Failed to flip photo:');
  const handleRotate = () => void applyTransform(rotateStoredPhoto, 'Failed to rotate photo:');

  /** Discards every staged edit — flip/rotate included, not just the crop insets — back to sourceUri untouched. */
  function handleReset() {
    setWorkingUri(null);
    setInsets(NO_INSETS);
  }

  async function handleSave() {
    if (!item || !previewUri) return;
    setSaving(true);
    try {
      const cropped = isNoOpInsets(insets);
      const finalUri = cropped ? previewUri : await cropStoredPhoto(previewUri, insets);
      // A manual crop can trim away background-framer's baked margin — see
      // imageMarginBaked's doc comment in types/wardrobe.ts — so the result
      // must not be treated as still having one; a flip or rotate with no
      // crop preserves it, the same as before this screen staged anything.
      await editItemImage(
        { runQuery: withDb },
        item,
        finalUri,
        { marginBaked: cropped ? item.imageMarginBaked : false },
      );
      navigation.goBack();
    } catch (e) {
      console.error('Failed to save image adjustments:', e);
      Alert.alert('Could not save the changes', 'The item still has its old picture.');
    } finally {
      setSaving(false);
    }
  }

  return {
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
  };
}
