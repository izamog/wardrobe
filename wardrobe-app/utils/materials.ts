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
  'Cashmere',
  'Corduroy',
  'Cotton',
  'Denim',
  'Down',
  'Elastane',
  'Fleece',
  'Hemp',
  'Leather',
  'Linen',
  'Lyocell',
  'Merino',
  'Modal',
  'Mohair',
  'Nylon',
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
