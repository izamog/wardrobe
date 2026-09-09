import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * The left-to-right grey gradient every garment photo sits on, per
 * design.md § Item grid rows — shared here so the closet grid, the item
 * details screen, and the upload preview all draw the exact same backdrop
 * rather than three independent hex pairs drifting apart over edits.
 */
export const ITEM_PHOTO_GRADIENT: [string, string] = ['#F1F1F1', '#F6F6F6'];

/** Absolute-fill gradient backdrop — render first, behind the photo. */
export function ItemPhotoBackdrop() {
  return (
    <LinearGradient
      colors={ITEM_PHOTO_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
