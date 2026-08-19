import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ClosetScreen } from '../screens/ClosetScreen';
import { MatchScreen } from '../screens/MatchScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { AddItemScreen } from '../screens/AddItemScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { MatchesBrowserScreen } from '../screens/MatchesBrowserScreen';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// No icon font is installed, and pulling one in is a visual-design decision
// this phase defers. Emoji keep the tab bar readable in the meantime.
const TAB_ICONS: Record<keyof TabParamList, string> = {
  Closet: '👕',
  Match: '✓✕',
  Today: '☀️',
  Calendar: '🗓',
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#0f172a',
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 16 }}>{TAB_ICONS[route.name]}</Text>
        ),
      })}
    >
      {/* Closet is first, so it is the tab the app opens on. */}
      <Tab.Screen name="Closet" component={ClosetScreen} />
      <Tab.Screen name="Match" component={MatchScreen} />
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        {/* Add Item is a modal off the Closet FAB rather than a fifth tab: it
            is a flow that ends in a save or a cancel, not a place to sit. */}
        <Stack.Screen
          name="AddItem"
          component={AddItemScreen}
          options={{ presentation: 'modal', title: 'Add item' }}
        />
        <Stack.Screen name="ItemDetails" component={ItemDetailsScreen} options={{ title: 'Item' }} />
        <Stack.Screen
          name="MatchesBrowser"
          component={MatchesBrowserScreen}
          options={{ title: 'Matches' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
