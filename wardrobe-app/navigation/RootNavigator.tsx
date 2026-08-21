import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { OutfitMatchScreen } from '../screens/OutfitMatchScreen';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
  Closet: 'shirt-outline',
  Match: 'checkmark-circle-outline',
  Today: 'sunny-outline',
  Calendar: 'calendar-outline',
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
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name]} color={color} size={size} />
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
            second one above them. The title is still set, because iOS labels a
            pushed screen's back button with the title of the screen it came
            from — without it the label falls back to the route name, "Tabs". */}
        <Stack.Screen
          name="Tabs"
          component={Tabs}
          options={{ headerShown: false, title: 'Pieces' }}
        />
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
        <Stack.Screen
          name="OutfitMatch"
          component={OutfitMatchScreen}
          options={{ presentation: 'modal', title: 'Match from a photo' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
