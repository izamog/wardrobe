import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ClosetScreen } from '../screens/ClosetScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { AddItemScreen } from '../screens/AddItemScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { MatchesBrowserScreen } from '../screens/MatchesBrowserScreen';
import { ItemOutfitsScreen } from '../screens/ItemOutfitsScreen';
import { OutfitMatchScreen } from '../screens/OutfitMatchScreen';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { ImageAdjustmentsScreen } from '../screens/ImageAdjustmentsScreen';
import { LogOutfitScreen } from '../screens/LogOutfitScreen';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
  Closet: 'shirt-outline',
  Today: 'sunny-outline',
  Calendar: 'calendar-outline',
};

// One neutral surface, top and bottom — declared once and applied to the
// screen header, the tab bar, and (via tailwind.config.js's `paper` token)
// every BottomBar-based footer, so the chrome above and below the content
// reads as one continuous surface rather than two differently-coloured bars.
// React Navigation's header/tab-bar options take raw color/font values, not
// NativeWind classNames, so these mirror tailwind.config.js's `paper` / `ink`
// tokens and the display serif directly rather than through a className.
const SURFACE_COLOR = '#FFFFFF';
const INK_COLOR = '#1A1714';
const INK_MUTED_COLOR = '#6B6259';

// Screen titles: Playfair Display 400 — see design.md § Typography.
const HEADER_STYLE = {
  headerStyle: { backgroundColor: SURFACE_COLOR },
  headerTitleStyle: { color: INK_COLOR, fontFamily: 'PlayfairDisplay_400Regular', fontSize: 20 },
  headerTintColor: INK_COLOR,
  headerShadowVisible: false,
} as const;

// No border/shadow, same background as HEADER_STYLE — the tab bar used to
// default to plain white with a grey top border, which is exactly what read
// as "a different bar" from the ivory/serif header above it.
const TAB_BAR_STYLE = {
  backgroundColor: SURFACE_COLOR,
  borderTopWidth: 0,
  elevation: 0,
  shadowOpacity: 0,
} as const;

// Tab labels at the bottom: Public Sans 400 — see design.md § Typography.
// No fontSize override — only the family changes, so the label keeps
// whatever size the navigator already sizes it at.
const TAB_BAR_LABEL_STYLE = { fontFamily: 'PublicSans_400Regular' } as const;

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
        tabBarStyle: TAB_BAR_STYLE,
        tabBarLabelStyle: TAB_BAR_LABEL_STYLE,
        tabBarActiveTintColor: INK_COLOR,
        tabBarInactiveTintColor: INK_MUTED_COLOR,
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name]} color={color} size={size} />
        ),
      })}
    >
      {/* Closet is first, so it is the tab the app opens on. Rating pairs
          lives in each item's own "Matches" screen (MatchesBrowserScreen),
          not as a standalone tab. */}
      <Tab.Screen name="Closet" component={ClosetScreen} />
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
          options={{ headerShown: false, title: 'Closet' }}
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
          name="ItemOutfits"
          component={ItemOutfitsScreen}
          options={{ title: 'Outfits with this item' }}
        />
        <Stack.Screen
          name="OutfitMatch"
          component={OutfitMatchScreen}
          options={{ presentation: 'modal', title: 'Match from a photo' }}
        />
        <Stack.Screen name="Archive" component={ArchiveScreen} options={{ title: 'Archive' }} />
        <Stack.Screen
          name="ImageAdjustments"
          component={ImageAdjustmentsScreen}
          options={{ presentation: 'modal', title: 'Image adjustments' }}
        />
        <Stack.Screen
          name="LogOutfit"
          component={LogOutfitScreen}
          options={{ presentation: 'modal', title: 'Log outfit' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
