/**
 * Query and mapping code against the structural ItemsDatabase interface (see
 * wardrobe-app/AGENTS.md: "Only services/database.ts imports expo-sqlite").
 *
 * Split into itemsShared (types + row mapping), itemsCrud, itemsCompatibility
 * and itemsOutfitLog for file size; this file re-exports all of them so every
 * existing `from '../services/items'` / `from './items'` import keeps working
 * unchanged.
 */
export * from './itemsShared';
export * from './itemsCrud';
export * from './itemsCompatibility';
export * from './itemsOutfitLog';
