import { ALL_CATEGORIES } from './categories';
import { ALL_COLORS, toColorPair } from './colors';
import { ALL_MATERIALS } from './materials';
import { SCALE_MAX } from './format';
import type { Category, HardwareColor, ItemColor } from '../types/wardrobe';

/**
 * What a spoken description was understood to say.
 *
 * Every field is optional and `undefined` means "not heard". That is a
 * deliberately coarser contract than a confidence score: a threshold would
 * have to be calibrated against real speech I cannot collect, whereas
 * "returned a usable value or did not" is a rule that can be tested.
 */
export interface ItemProposal {
  brand?: string;
  costMinorUnits?: number;
  primaryColor?: ItemColor;
  secondaryColor?: ItemColor;
  category?: Category;
  isSecondHand?: boolean;
  materials?: string[];
  hardwareColor?: HardwareColor;
  hasBeltLoops?: boolean;
  inferredWarmth?: number;
  inferredWind?: number;
}

/**
 * Longest brand string accepted.
 *
 * A brand is a few words. Anything longer is the model having narrated rather
 * than answered, and it would be stored and shown on every tile.
 */
const MAX_BRAND_LENGTH = 60;

/** £100,000. Above this the model has misheard a year, a phone number or a size. */
const MAX_COST_MINOR_UNITS = 10_000_000;

const HARDWARE_COLORS: readonly HardwareColor[] = ['Gold', 'Silver', 'None'];

/**
 * Finds `value` in a vocabulary, ignoring case and surrounding space.
 *
 * The model is asked for exact terms but returns "navy" or " Cotton" often
 * enough that rejecting those would throw away correct answers over
 * presentation. Returns the vocabulary's own spelling, so what reaches the
 * database is always the canonical form.
 */
function matchVocabulary<T extends string>(value: unknown, vocabulary: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const needle = value.trim().toLowerCase();
  return vocabulary.find((entry) => entry.toLowerCase() === needle) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseBrand(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const brand = value.trim();
  if (brand === '' || brand.length > MAX_BRAND_LENGTH) return undefined;
  // 'Unknown' is the column default, so proposing it is the same as saying
  // nothing — and it would occupy a card the user has to dismiss.
  if (brand.toLowerCase() === 'unknown') return undefined;
  return brand;
}

/**
 * Converts a spoken price to whole minor units.
 *
 * The model is asked for a decimal amount in pounds rather than pence, because
 * asking it to do the unit conversion invites an answer that is out by a
 * factor of a hundred and looks entirely plausible.
 */
function parseCostInPounds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  const minorUnits = Math.round(value * 100);
  if (minorUnits > MAX_COST_MINOR_UNITS) return undefined;
  return minorUnits;
}

/**
 * Reads at most two colours from the model's answer.
 *
 * Recognises the colours, then defers to toColorPair for the pairing rules, so
 * a spoken description and a tap in the picker cannot disagree about what is
 * storable.
 */
function parseColors(value: unknown): { primaryColor?: ItemColor; secondaryColor?: ItemColor } {
  if (!Array.isArray(value)) return {};

  const recognised: ItemColor[] = [];
  for (const entry of value) {
    const color = matchVocabulary(entry, ALL_COLORS);
    if (color && !recognised.includes(color)) recognised.push(color);
  }

  const { primaryColor, secondaryColor } = toColorPair(recognised);
  return {
    ...(primaryColor !== '' && { primaryColor }),
    ...(secondaryColor !== '' && { secondaryColor }),
  };
}

function parseMaterialList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const matched = new Set<string>();
  for (const entry of value) {
    const material = matchVocabulary(entry, ALL_MATERIALS);
    if (material) matched.add(material);
  }
  if (matched.size === 0) return undefined;

  return ALL_MATERIALS.filter((material) => matched.has(material));
}

/**
 * Reads one of the 0-10 estimates, clamping rather than rejecting.
 *
 * The asymmetry with every other field is deliberate. Brand and cost are facts
 * the model either heard or did not, so a bad value is discarded. Warmth is an
 * estimate on an arbitrary scale, and a model answering 12 for a heavy parka
 * has conveyed something true about the garment — clamping keeps that signal
 * where discarding it would lose it.
 */
function parseScaleEstimate(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(SCALE_MAX, Math.max(0, Math.round(value)));
}

function parseBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Brand, category, materials and hardware colour — the identity fields. */
function applyIdentityFields(source: Record<string, unknown>, proposal: ItemProposal): void {
  const brand = parseBrand(source.brand);
  if (brand !== undefined) proposal.brand = brand;

  const category = matchVocabulary(source.category, ALL_CATEGORIES);
  if (category !== null) proposal.category = category;

  const materials = parseMaterialList(source.materials);
  if (materials !== undefined) proposal.materials = materials;

  const hardwareColor = matchVocabulary(source.hardwareColor, HARDWARE_COLORS);
  if (hardwareColor !== null) proposal.hardwareColor = hardwareColor;
}

/** Cost, condition and the warmth/wind estimates — the quantity fields. */
function applyQuantityFields(source: Record<string, unknown>, proposal: ItemProposal): void {
  const costMinorUnits = parseCostInPounds(source.costInPounds);
  if (costMinorUnits !== undefined) proposal.costMinorUnits = costMinorUnits;

  const isSecondHand = parseBoolean(source.isSecondHand);
  if (isSecondHand !== undefined) proposal.isSecondHand = isSecondHand;

  const hasBeltLoops = parseBoolean(source.hasBeltLoops);
  if (hasBeltLoops !== undefined) proposal.hasBeltLoops = hasBeltLoops;

  const inferredWarmth = parseScaleEstimate(source.inferredWarmth);
  if (inferredWarmth !== undefined) proposal.inferredWarmth = inferredWarmth;

  const inferredWind = parseScaleEstimate(source.inferredWind);
  if (inferredWind !== undefined) proposal.inferredWind = inferredWind;
}

/**
 * Turns a language model's answer into the subset the app is willing to store.
 *
 * The model is an input source, not an authority. Structured output constrains
 * the shape of its reply but nothing about the values inside it, so every
 * field is checked here against the same vocabularies and ranges the CHECK
 * constraints enforce. Anything that fails becomes "not heard" rather than
 * reaching the database and failing there.
 *
 * Never throws: malformed input yields an empty proposal, because a garbled
 * reply should cost the user a retry, not a crash.
 */
export function parseExtraction(raw: unknown): ItemProposal {
  const source = asRecord(raw);
  const proposal: ItemProposal = {};

  applyIdentityFields(source, proposal);
  applyQuantityFields(source, proposal);

  const { primaryColor, secondaryColor } = parseColors(source.colors);
  if (primaryColor !== undefined) proposal.primaryColor = primaryColor;
  if (secondaryColor !== undefined) proposal.secondaryColor = secondaryColor;

  return proposal;
}
