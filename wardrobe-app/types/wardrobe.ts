export type Category =
  | 'Top'
  | 'Bottom'
  | 'Outerwear'
  | 'Shoes'
  | 'Belt'
  | 'Bag'
  | 'Scarf';

export type HardwareColor = 'Gold' | 'Silver' | 'Brass' | 'Black' | 'None';

export type CompatibilityStatus = 'MATCH' | 'DISMATCH';

export interface ClothingItem {
  id: string;
  imageUri: string;
  category: Category;
  brand: string;
  cost: number;
  isSecondHand: boolean;
  materials: string[]; // Stored as JSON string in SQLite
  hardwareColor: HardwareColor;
  hasBeltLoops: boolean;
  inferredWarmth: number; // Scale 0-10
  inferredWind: number;   // Scale 0-10
  wearCount: number;
  createdAt: string;
}

export interface ItemCompatibility {
  id: string;
  itemAId: string;
  itemBId: string;
  status: CompatibilityStatus;
  createdAt: string;
}

export interface OutfitLog {
  id: string;
  date: string; // ISO Format: YYYY-MM-DD
  itemIds: string[]; // Stored as JSON string in SQLite
  collageImageUri: string;
  createdAt: string;
}
