import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, PlayfairDisplay_400Regular } from '@expo-google-fonts/playfair-display';
import {
  PublicSans_300Light,
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
} from '@expo-google-fonts/public-sans';
import { initDatabase, withDb } from './services/database';
import { purgeExpiredArchivedItems } from './services/itemActions';
import { RootNavigator } from './navigation/RootNavigator';
import { TodayDataProvider } from './contexts/TodayDataContext';
import './global.css';

export default function App() {
  const [error, setError] = useState<string | null>(null);
  // Loading these here (rather than nowhere) is what makes them available at
  // all; not awaiting fontsLoaded before rendering (see below) means a
  // screen's first paint can briefly show the system fallback font before
  // swapping to the real one a frame later — an accepted trade for not
  // blocking the whole app on it.
  useFonts({
    PlayfairDisplay_400Regular,
    PublicSans_300Light,
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
  });

  useEffect(() => {
    async function prepare() {
      try {
        await initDatabase();
        // Not awaited before proceeding, and its own failure is swallowed
        // rather than surfaced: sweeping expired archive entries is
        // maintenance, not something the user should wait on or see fail —
        // a wardrobe that can't be opened because a filesystem cleanup step
        // errored would be a strictly worse trade than the sweep simply
        // trying again on the next launch.
        purgeExpiredArchivedItems({ runQuery: withDb }).catch((e: unknown) => {
          console.error('Failed to purge expired archive entries:', e);
        });
      } catch (e) {
        console.error('Database initialization failed:', e);
        setError('Failed to initialize local database.');
      }
    }
    void prepare();
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="dark" />
      {/* Mounted unconditionally, on the very first render, same as
          RootNavigator below — Today's own initDatabase() call (see
          contexts/TodayDataContext.tsx) is what actually waits for the
          database; the location fix and the weather fetch need no database
          at all. */}
      <TodayDataProvider>
        {error ? (
          // A genuine failure state, not a loading one — nothing in the app
          // can function without the database, so this is the one case that
          // still replaces the whole tree rather than letting a screen show
          // its own error inline.
          <SafeAreaView className="flex-1 bg-red-50 justify-center items-center p-4">
            <Text className="text-red-600 font-sans-semibold text-lg">{error}</Text>
          </SafeAreaView>
        ) : (
          // No "Opening your wardrobe…" splash: the navigator renders
          // immediately, and each screen shows its own loading state (e.g.
          // ClosetScreen's spinner while its first query resolves) instead
          // of the whole app hiding behind one full-screen gate. withDb
          // itself now awaits initDatabase() before every query (see
          // services/database.ts), which is what makes it safe for a screen
          // to query the moment it mounts, before the schema is
          // necessarily migrated yet.
          <RootNavigator />
        )}
      </TodayDataProvider>
    </SafeAreaProvider>
  );
}
