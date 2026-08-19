import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BouncingDots } from './BouncingDots';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { describeVoiceFailure, VoiceError } from '../utils/voiceErrors';
import type { ItemProposal } from '../utils/proposals';
import type { VoicePipeline } from '../services/voice';

/** Where the capture has got to, so the UI can say something specific at each point. */
export type VoiceStage = 'idle' | 'recording' | 'transcribing' | 'extracting';

/**
 * Discards a recording.
 *
 * Called from a finally, so it must not throw: a failure to delete a temporary
 * file should never turn a successful ingestion into an error, and never mask
 * the real one when the ingestion already failed.
 */
function discardRecording(uri: string | null): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('Could not delete recording', e);
  }
}

/**
 * Hold-to-talk capture as a bottom bar: a prompt on the left, the button right.
 *
 * The recording is deleted on every path — success, failure, and permission
 * refusal — and is never copied anywhere permanent. Audio does leave the
 * device to be transcribed, which is the trade this phase accepts; keeping the
 * file for no longer than the request is what limits it.
 */
export function VoiceBar({
  pipeline,
  onProposal,
  onTranscript,
}: {
  pipeline: VoicePipeline;
  onProposal: (proposal: ItemProposal) => void;
  onTranscript?: (transcript: string) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [stage, setStage] = useState<VoiceStage>('idle');
  // Guards against a press-in that is still preparing when the finger lifts,
  // which would otherwise stop a recorder that had not started.
  const startingRef = useRef(false);

  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  }, []);

  const start = useCallback(async () => {
    if (stage !== 'idle' || startingRef.current) return;
    startingRef.current = true;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Microphone needed',
          'Wardrobe needs the microphone to hear your description. You can turn it on in Settings.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStage('recording');
    } catch (e) {
      console.error('Could not start recording:', e);
      Alert.alert('Could not start recording', 'Please try again.');
    } finally {
      startingRef.current = false;
    }
  }, [recorder, stage]);

  const stopAndIngest = useCallback(async () => {
    if (stage !== 'recording') return;

    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      if (!uri) throw new VoiceError('empty-transcript', 'recorder produced no file');

      setStage('transcribing');
      const transcript = await pipeline.transcribe(uri);
      onTranscript?.(transcript);

      setStage('extracting');
      onProposal(await pipeline.extract(transcript));
    } catch (e) {
      console.error('Voice ingestion failed:', e);
      Alert.alert(
        'Voice input',
        e instanceof VoiceError
          ? [describeVoiceFailure(e.reason), e.detail].filter(Boolean).join('\n\n')
          : 'Something went wrong. You can type the details instead.',
      );
    } finally {
      // Before the state reset, so an early return can never skip it.
      discardRecording(uri);
      setStage('idle');
    }
  }, [onProposal, onTranscript, pipeline, recorder, stage]);

  const busy = stage === 'transcribing' || stage === 'extracting';
  const seconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center px-4 pt-3 bg-white border-t border-slate-200"
      // The home indicator sits over anything drawn at the very bottom, which
      // put the microphone half under it. The inset comes from the device, so
      // this is right on every model; the extra 12 keeps it comfortably clear
      // rather than merely legal.
      style={{ paddingBottom: insets.bottom + 12 }}
    >
      <View className="flex-1 mr-4">
        {busy ? (
          <BouncingDots />
        ) : stage === 'recording' ? (
          <Text className="text-sm font-medium text-slate-900">Listening… {seconds}s</Text>
        ) : (
          <>
            <Text className="text-sm font-medium text-slate-900">Describe your item</Text>
            <Text className="text-xs text-slate-500 mt-0.5">
              Brand, cost, colour, new or second-hand
            </Text>
          </>
        )}
      </View>

      <Pressable
        onPressIn={() => void start()}
        onPressOut={() => void stopAndIngest()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Hold to describe this item"
        className={`w-16 h-16 rounded-full items-center justify-center ${
          stage === 'recording' ? 'bg-rose-600' : busy ? 'bg-slate-200' : 'bg-slate-900'
        }`}
      >
        {/* No glyph while recording: the button turning red is the whole
            message, and an icon on top of it just competes. */}
        {stage === 'recording' ? null : (
          <Ionicons name="mic" size={28} color={busy ? '#94a3b8' : '#ffffff'} />
        )}
      </Pressable>
    </View>
  );
}
