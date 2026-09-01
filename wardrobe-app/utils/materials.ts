import type { MaterialEntry } from '../types/wardrobe';

/**
 * The materials the picker offers.
 *
 * Not enforced by the database: materials are stored as a JSON array in a TEXT
 * column, and a CHECK constraint cannot reasonably police the contents of one.
 * The list is the app's vocabulary, not the schema's, so a value stored by an
 * older build is kept rather than discarded — see MultiSelectField, which adds
 * any unrecognised stored value to its own options.
 *
 * Alphabetical, and a test holds it that way: this is the order the picker
 * shows and the order a selection is stored in, so it has to be findable
 * rather than reflect how someone once grouped fibres.
 */
export const ALL_MATERIALS: readonly string[] = [
  'Acrylic',
  'Alpaca',
  'Bamboo',
  'Canvas',
  'Cashmere',
  'Corduroy',
  'Cotton',
  'Denim',
  'Down',
  'Elastane',
  'Faux Leather',
  'Fleece',
  'Fur',
  'Hemp',
  'Leather',
  'Linen',
  'Lyocell',
  'Merino',
  'Modal',
  'Mohair',
  'Nylon',
  'Polyamide',
  'Polyester',
  'Satin',
  'Sheepskin',
  'Silk',
  'Suede',
  'Tweed',
  'Velvet',
  'Viscose',
  'Wool',
];

/**
 * Turns an item's MaterialEntry[] into the name-keyed lookup
 * utils/warmth.ts's estimateWarmth expects for its own materialPercents
 * parameter — the one place this conversion happens, so AddItemScreen and
 * ItemDetailsScreen (the two callers with a real MaterialEntry[] on hand)
 * can't drift on how they build it.
 *
 * A 0 (or missing) percent is dropped rather than kept as 0: estimateWarmth
 * treats "not recorded" as excluded from the weighted average, not as
 * "recorded at 0%" — see MaterialEntry's own doc comment.
 */
export function materialPercentsFrom(materials: readonly MaterialEntry[]): Partial<Record<string, number>> {
  const percents: Partial<Record<string, number>> = {};
  for (const entry of materials) {
    if (entry.percent > 0) percents[entry.material] = entry.percent;
  }
  return percents;
}

/**
 * Reconciles MultiSelectField's plain-name selection (what materials, not
 * how much of each) against the current MaterialEntry[] — keeps an existing
 * entry's percent for a name that's still selected, drops an entry for a
 * name that's been deselected, and adds a fresh `percent: 0` entry for a
 * newly selected name, in `names`' own order (MultiSelectField's). Shared
 * by AttributeList.tsx and ItemDetailsScreen.tsx, the two screens with a
 * materials picker.
 */
export function reconcileMaterials(
  current: readonly MaterialEntry[],
  names: readonly string[],
): MaterialEntry[] {
  return names.map((name) => current.find((entry) => entry.material === name) ?? { material: name, percent: 0 });
}
