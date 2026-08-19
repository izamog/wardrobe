import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { initDatabase } from './services/database';
import "./global.css";

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function prepare() {
      try {
        await initDatabase();
        setIsReady(true);
      } catch (e) {
        console.error("Database initialization failed:", e);
        setError("Failed to initialize local database.");
      }
    }
    prepare();
  }, []);

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-red-50 justify-center items-center p-4">
        <StatusBar style="dark" />
        <Text className="text-red-600 font-bold text-lg">{error}</Text>
      </SafeAreaView>
    );
  }

  if (!isReady) {
    return (
      <SafeAreaView className="flex-1 bg-slate-900 justify-center items-center">
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text className="text-slate-300 mt-4 text-base">Initializing Wardrobe DB...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-900 justify-center items-center p-6">
      <StatusBar style="light" />
      <View className="bg-slate-800 p-6 rounded-2xl border border-slate-700 items-center">
        <Text className="text-2xl font-bold text-white mb-2">Wardrobe App</Text>
        <Text className="text-sky-400 text-sm font-medium">Phase 1 Initialized Successfully</Text>
        <Text className="text-slate-400 text-xs mt-4 text-center">
          SQLite Schema & Categories Engine Online
        </Text>
      </View>
    </SafeAreaView>
  );
}
