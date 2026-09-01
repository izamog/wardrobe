import type { ItemColor } from '../types/wardrobe';

/**
 * The colour vocabulary, in picker order.
 *
 * Alphabetical, same reasoning as ALL_MATERIALS in utils/materials.ts: a
 * findable order, rather than one that reflects how someone once grouped
 * shades by family. Mirrored by CHECK constraints in services/migrations.ts.
 *
 * 'Multi' is a statement that no single colour describes the garment, which is
 * why it cannot be combined with a second colour — see canCombineColors. It
 * sorts alphabetically with the rest rather than being pinned last, same as
 * every other entry.
 */
export const ALL_COLORS: readonly ItemColor[] = [
  'Beige',
  'Black',
  'Blue',
  'Brown',
  'Burgundy',
  'Cream',
  'Gold',
  'Green',
  'Grey',
  'Multi',
  'Navy',
  'Olive',
  'Orange',
  'Pink',
  'Purple',
  'Red',
  'Silver',
  'Tan',
  'Teal',
  'White',
  'Yellow',
];

const COLOR_SET: ReadonlySet<string> = new Set(ALL_COLORS);

/** Narrows an untrusted string to a colour, or null. Used on the model's output. */
export function toItemColor(value: unknown): ItemColor | null {
  return typeof value === 'string' && COLOR_SET.has(value) ? (value as ItemColor) : null;
}

/**
 * Whether a second colour may sit alongside `primary`.
 *
 * 'Multi' already means "more colours than are worth naming", so pairing it
 * with one specific colour says nothing coherent. Nothing else is restricted.
 */
export function canCombineColors(primary: ItemColor | null): boolean {
  return primary !== null && primary !== 'Multi';
}

/**
 * Reduces a set of chosen colours to the pair the schema stores.
 *
 * Keeps vocabulary order rather than the order they were tapped, so the same
 * two colours always land in the same columns and an item is not "Navy/Cream"
 * one day and "Cream/Navy" the next.
 *
 * 'Multi' only ever stands alone, and loses to any specific colour offered
 * with it: it summarises a garment no single colour describes, so it carries
 * almost no signal for matching where a named colour carries a lot. The schema
 * forbids it in the secondary column outright.
 *
 * Total by construction — every input produces a pair the CHECK constraints
 * accept, so the UI cannot offer a combination the database will reject.
 */
export function toColorPair(chosen: readonly ItemColor[]): {
  primaryColor: ItemColor | '';
  secondaryColor: ItemColor | '';
} {
  const specific = ALL_COLORS.filter((color) => color !== 'Multi' && chosen.includes(color));
  const ordered: readonly ItemColor[] =
    specific.length > 0 ? specific : chosen.includes('Multi') ? ['Multi'] : [];

  return {
    primaryColor: ordered[0] ?? '',
    secondaryColor: ordered[1] ?? '',
  };
}
