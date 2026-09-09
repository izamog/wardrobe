import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState } from '../components/EmptyState';
import { usePhotoCapture } from '../components/PhotoPicker';
import { useDbQuery } from '../hooks/useDbQuery';
import { archiveItems, getItem, updateItem } from '../services/items';
import { useTodayData } from '../contexts/TodayDataContext';
import { replaceItemImage } from '../services/itemActions';
import { withDb } from '../services/database';
import type { RootStackParamList } from '../navigation/types';
import {
  toDraft,
  buildItemUpdate,
  EditForm,
  ReadOnlyDetails,
  PhotoHeader,
  WearStatsRow,
  EstimatesEditor,
  ActionButtons,
  type Draft,
} from './ItemDetailsScreenComponents';

export function ItemDetailsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { itemId } = useRoute<RouteProp<RootStackParamList, 'ItemDetails'>>().params;
  const { height: windowHeight } = useWindowDimensions();

  const { data: item, error, loading, reload } = useDbQuery((db) => getItem(db, itemId), [itemId]);
  const { invalidate: invalidateToday } = useTodayData();
  const [draft, setDraft] = useState<Draft | null>(null);
  // Read-only until asked. Most visits to this screen are to look something up,
  // and a screen of live text fields invites edits nobody meant to make.
  const [editing, setEditing] = useState(false);

  // Seeding on every load rather than only when draft is null keeps the form in
  // step with the row after a save; the screen reloads on focus, so a stale
  // draft would otherwise survive edits made elsewhere.
  useEffect(() => {
    if (item) setDraft(toDraft(item));
  }, [item]);

  // Declared before the early returns below, because hooks cannot be called
  // conditionally. It no-ops until the item has loaded.
  const onPhotoPicked = useCallback(
    (image: { uri: string }) => {
      void (async () => {
        if (!item) return;
        try {
          await replaceItemImage({ runQuery: withDb }, item, { original: image.uri });
          await reload();
        } catch (e) {
          console.error('Failed to replace photo:', e);
          Alert.alert('Could not save the photo', 'The item still has its old picture.');
        }
      })();
    },
    [item, reload],
  );
  const { capture, busy: capturing } = usePhotoCapture(onPhotoPicked);

  const choosePhoto = useCallback(() => {
    Alert.alert('Item photo', undefined, [
      { text: 'Take a photo', onPress: () => void capture('camera') },
      { text: 'Choose from library', onPress: () => void capture('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [capture]);

  // A useCallback, not a plain function declared after the early returns
  // below: the header's "Done" button is registered through
  // navigation.setOptions in the layout effect that follows, and that
  // registration only re-runs when its own dependency array changes. A
  // plain closure referenced there would keep calling whatever `draft` was
  // current the *last* time editing was toggled, not the latest one — this
  // Save being memoized on [draft, itemId, navigation] is what keeps the
  // header button (and the bottom "Save changes" button) both calling the
  // version that actually has the user's edits.
  const save = useCallback(async () => {
    if (!draft) return;
    const update = buildItemUpdate(draft);
    if ('error' in update) {
      Alert.alert(update.errorTitle, update.error);
      return;
    }

    try {
      await withDb((db) => updateItem(db, itemId, update));
      // Any edited field can change whether/how this item shows up in
      // Today -- see TodayDataContext's own doc comment for why nothing
      // refreshes its cached candidate pool on its own.
      invalidateToday();
      navigation.goBack();
    } catch (e) {
      console.error('Failed to update item:', e);
      Alert.alert('Could not save', 'Your changes were not stored.');
    }
  }, [draft, itemId, navigation, invalidateToday]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          // "Done" saves — it does not merely close the edit form. It used
          // to just flip `editing` back to false, which left the draft's
          // edits sitting unsaved in memory while the screen switched back
          // to ReadOnlyDetails (which renders the untouched `item`, not the
          // draft) — indistinguishable from the edit having been silently
          // discarded. Entering edit mode is still a separate, cheap toggle;
          // leaving it now goes through the same save() the bottom button
          // uses, so there is one way to persist a change, not two
          // half-implemented ones.
          onPress={() => (editing ? void save() : setEditing(true))}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Save changes' : 'Edit item'}
          hitSlop={12}
          className="px-2 py-1"
        >
          {editing ? (
            <Text className="text-base font-sans-medium text-ink">Done</Text>
          ) : (
            <Ionicons name="create-outline" size={22} color="#1A1714" />
          )}
        </Pressable>
      ),
    });
  }, [navigation, editing, save]);

  if (error) return <EmptyState title={error} />;
  if (loading && !item) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }
  if (!item || !draft) return <EmptyState title="This item no longer exists." />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  // EstimatesEditor is shown even outside `editing` (see its own doc comment),
  // but ActionButtons' "Save changes" -- and the header's Done-saves button --
  // only appear once `editing` is true. Without this, resetting or typing a
  // new warmth/wind value from the read-only view updated `draft` with no way
  // to persist it: the value showed correctly on screen but was silently
  // discarded the moment the screen was left, then reappeared unchanged next
  // visit. Routing its edits through `set` too keeps every write going
  // through the same single setter, just also opening the session that can
  // actually save it.
  const setAndEdit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setEditing(true);
    set(key, value);
  };

  // Archives rather than hard-deletes -- same as ClosetScreen's bulk delete
  // (see confirmAndArchive there), so there is exactly one way to delete an
  // item and it always goes through the 30-day Archive/restore window, not
  // two behaviours depending on which screen you delete from.
  function confirmDelete() {
    Alert.alert('Delete this item?', 'Deleted items are held for 30 days before being removed for good — you can restore them from Archive until then.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!item) return;
            try {
              await withDb((db) => archiveItems(db, [item.id]));
              invalidateToday();
              navigation.goBack();
            } catch (e) {
              console.error('Failed to delete item:', e);
              Alert.alert('Could not delete', 'The item is still there.');
            }
          })();
        },
      },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerClassName="pb-10">
      <PhotoHeader
        item={item}
        editing={editing}
        capturing={capturing}
        choosePhoto={choosePhoto}
        onAdjustImage={() => navigation.navigate('ImageAdjustments', { itemId })}
        windowHeight={windowHeight}
      />
      <WearStatsRow item={item} />

      <View className="p-5">
        {editing ? <EditForm draft={draft} set={set} /> : <ReadOnlyDetails item={item} />}
        <EstimatesEditor draft={draft} set={setAndEdit} />
        <ActionButtons
          itemId={itemId}
          editing={editing}
          // Not `setEditing(false)` here: save() already navigates back on
          // success, so closing edit mode from here too was a race — on a
          // validation failure specifically, save() returns early (after
          // showing its own Alert) *without* navigating, and this used to
          // still flip the screen to read-only under that Alert regardless,
          // silently dropping back to a view that doesn't even show category
          // (see ReadOnlyDetails) with no visible sign anything was wrong.
          onSave={() => void save()}
          onDelete={confirmDelete}
          navigateToMatches={(id) => navigation.navigate('MatchesBrowser', { itemId: id })}
          navigateToOutfits={(id) => navigation.navigate('ItemOutfits', { itemId: id })}
        />
      </View>
    </ScrollView>
  );
}
