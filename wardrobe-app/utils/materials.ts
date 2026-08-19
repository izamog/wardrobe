/**
 * The materials the picker offers.
 *
 * Not enforced by the database: materials are stored as a JSON array in a TEXT
 * column, and a CHECK constraint cannot reasonably police the contents of one.
 * The list is the app's vocabulary, not the schema's, so a value stored by an
 * older build is kept rather than discarded — see MultiSelectField, which adds
 * any unrecognised stored value to its own options.
 *
 * Grouped loosely by fibre type, which is also the order they are shown in.
 */
export const ALL_MATERIALS: readonly string[] = [
  // Natural plant
  'Cotton',
  'Linen',
  'Hemp',
  'Bamboo',
  // Natural animal
  'Wool',
  'Merino',
  'Cashmere',
  'Mohair',
  'Alpaca',
  'Silk',
  'Down',
  // Leathers
  'Leather',
  'Suede',
  'Sheepskin',
  // Manufactured
  'Viscose',
  'Modal',
  'Lyocell',
  'Polyester',
  'Nylon',
  'Acrylic',
  'Elastane',
  // Constructions worth recording in their own right
  'Denim',
  'Corduroy',
  'Fleece',
  'Velvet',
  'Tweed',
  'Satin',
];
