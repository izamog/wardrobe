import type { HardwareColor } from '../types/wardrobe';

/**
 * Which hardware finishes read as compatible on the same outfit.
 *
 * Gold and Brass read as the same "warm metal" family; Silver and Black read
 * as the same "cool metal" family. 'None' is deliberately absent as a key:
 * an item with no visible hardware has nothing to clash, so it is handled as
 * a special case in hardwareColorsCompatible rather than listed here.
 *
 * Each finish pairs with itself as well as its family partner -- Gold does
 * not exclude Gold -- which is why every entry lists itself first.
 */
const HARDWARE_FAMILY: Record<Exclude<HardwareColor, 'None'>, readonly HardwareColor[]> = {
  Gold: ['Gold', 'Brass'],
  Brass: ['Gold', 'Brass'],
  Silver: ['Silver', 'Black'],
  Black: ['Silver', 'Black'],
};

/**
 * Whether two items' hardware finishes are allowed on the same outfit.
 *
 * 'None' matches anything: an item with no visible hardware has nothing for
 * the other piece's finish to clash with.
 */
export function hardwareColorsCompatible(a: HardwareColor, b: HardwareColor): boolean {
  if (a === 'None' || b === 'None') return true;
  return HARDWARE_FAMILY[a].includes(b);
}
