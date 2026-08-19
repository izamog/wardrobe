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

// White header on a light app. Declared once and applied to both navigators so
// the strip behind the status bar is the same colour on every screen.
const HEADER_STYLE = {
  headerStyle: { backgroundColor: '#ffffff' },
  headerTitleStyle: { color: '#0f172a' },
  headerTintColor: '#0f172a',
  headerShadowVisible: false,
} as const;

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // Headers are shown, not hidden, and that is what keeps content clear
        // of the notch or Dynamic Island: React Navigation's header pads itself
        // by the device's top safe-area inset and paints its background across
        // that padding. A screen with no header starts at y=0 and slides under
        // the cutout. The inset comes from the device, so this is correct on
        // every model rather than tuned to one.
        //
        // Set explicitly rather than left to the navigator's default, so the
        // behaviour the layout depends on is stated where it is read.
        headerShown: true,
        ...HEADER_STYLE,
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
      <Stack.Navigator screenOptions={HEADER_STYLE}>
        {/* The tab navigator draws its own headers, so the stack must not add a
            second one above them. */}
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
