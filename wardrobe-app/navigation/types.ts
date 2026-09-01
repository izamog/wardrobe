import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Category } from '../types/wardrobe';

export type TabParamList = {
  Closet: undefined;
  Today: undefined;
  Calendar: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  /**
   * `category` preselects the picker when the flow is opened from a filtered
   * Closet, so adding three tops in a row doesn't mean re-picking each time.
   */
  AddItem: { category?: Category } | undefined;
  ItemDetails: { itemId: string };
  MatchesBrowser: { itemId: string };
  ItemOutfits: { itemId: string };
  OutfitMatch: undefined;
  Archive: undefined;
  ImageAdjustments: { itemId: string };
  /** date is YYYY-MM-DD — the Calendar day being logged or re-logged. */
  LogOutfit: { date: string };
};
