import type { ClothingItem } from '../types/wardrobe';

/**
 * Turning the wardrobe into a CSV the user can hand over when reporting an
 * outfit-recommendation bug — every field the generator/scoring pipeline
 * actually reads (utils/warmth.ts, utils/outfitScoring.ts, utils/pairs.ts),
 * so a reported issue can be reproduced from the export alone rather than
 * asking the user to enumerate their closet by hand. Deliberately excludes
 * fields the algorithm never consults: id, photo paths, cost, purchase
 * date, second-hand flag, wear count and dates — none of those explain why
 * a particular outfit was or wasn't recommended, so they'd only be noise
 * here.
 *
 * Pure string logic, no filesystem/sharing — see services/wardrobeExport.ts
 * for the part that actually writes and shares the file, which isn't
 * unit-testable off-device the way this is.
 */

const COLUMNS = [
  'brand',
  'category',
  'primaryColor',
  'secondaryColor',
  'material1',
  'material1Percent',
  'material2',
  'material2Percent',
  'hardwareColor',
  'hasBeltLoops',
  'sleeveLength',
  'length',
  'thickness',
  'denier',
  'backless',
  'inferredWarmth',
  'inferredWind',
  'isWorkAppropriate',
] as const;

/**
 * RFC 4180 field escaping, plus CSV/spreadsheet formula-injection
 * neutralization: a value starting with =, +, - or @ is prefixed with a
 * leading `'` so a spreadsheet app opening the export reads it as literal
 * text rather than evaluating it as a formula — user-entered fields like
 * brand are free text, and this export is meant to be opened and shared,
 * not just read back by this app.
 */
function csvField(value: string | number | boolean): string {
  const raw = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  const str = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowFor(item: ClothingItem): string {
  const [material1, material2] = item.materials;
  return [
    item.brand,
    item.category,
    item.primaryColor,
    item.secondaryColor,
    material1?.material ?? '',
    material1?.percent ?? '',
    material2?.material ?? '',
    material2?.percent ?? '',
    item.hardwareColor,
    item.hasBeltLoops,
    item.sleeveLength,
    item.length,
    item.thickness,
    item.denier,
    item.backless,
    item.inferredWarmth,
    item.inferredWind,
    item.isWorkAppropriate,
  ]
    .map(csvField)
    .join(',');
}

/** One CSV document for the given items — a header row plus one row per item, in the order given. CRLF line endings, per RFC 4180. */
export function itemsToCsv(items: readonly ClothingItem[]): string {
  return [COLUMNS.join(','), ...items.map(rowFor)].join('\r\n');
}
