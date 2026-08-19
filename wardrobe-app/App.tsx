import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { initDatabase } from './services/database';
import { RootNavigator } from './navigation/RootNavigator';
import './global.css';

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function prepare() {
      try {
        await initDatabase();
        setIsReady(true);
      } catch (e) {
        console.error('Database initialization failed:', e);
        setError('Failed to initialize local database.');
      }
    }
    void prepare();
  }, []);

  // Nothing is rendered until the schema is up to date: every screen reads from
  // the database on focus, and a migration running underneath them would mean
  // querying tables that do not exist yet.
  if (error) {
    return (
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 bg-red-50 justify-center items-center p-4">
          <StatusBar style="dark" />
          <Text className="text-red-600 font-bold text-lg">{error}</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!isReady) {
    return (
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 bg-slate-50 justify-center items-center">
          <StatusBar style="dark" />
          <ActivityIndicator size="large" color="#0f172a" />
          <Text className="text-slate-500 mt-4 text-base">Opening your wardrobe…</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
