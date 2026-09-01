import { ALL_CATEGORIES, lengthOptionsFor } from './categories';
import { ALL_COLORS, toColorPair } from './colors';
import { ALL_MATERIALS } from './materials';
import { MAX_COST_MINOR_UNITS, parsePurchasedAtMonth, SCALE_MAX } from './format';
import type { Category, GarmentLength, HardwareColor, ItemColor, SleeveLength, Thickness } from '../types/wardrobe';

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
  sleeveLength?: SleeveLength;
  length?: GarmentLength;
  /**
   * Validated the same way every other field here is, but services/voice.ts's
   * extraction schema does not ask the model for thickness, denier or
   * backless yet — a spoken description cannot currently propose any of the
   * three, however clearly it implies one ("a mesh backless top"). Present
   * here, and correctly parsed if a caller ever does supply them, so adding
   * them to the schema later is a services/voice.ts change alone, not a type
   * or validation change too.
   */
  thickness?: Thickness;
  denier?: number;
  backless?: boolean;
  inferredWarmth?: number;
  inferredWind?: number;
  /** "YYYY-MM", the same shape the month picker writes — see parsePurchasedAtMonth. */
  purchasedAt?: string;
}

/**
 * Longest brand string accepted.
 *
 * A brand is a few words. Anything longer is the model having narrated rather
 * than answered, and it would be stored and shown on every tile.
 */
const MAX_BRAND_LENGTH = 60;

const HARDWARE_COLORS: readonly HardwareColor[] = ['Gold', 'Silver', 'Brass', 'Black', 'None'];
const SLEEVE_LENGTHS: readonly SleeveLength[] = ['Sleeveless', 'Short', 'Long'];
const THICKNESSES: readonly Thickness[] = ['Mesh', 'Light', 'Regular', 'Thick', 'Heavy'];
/** Same bounds as denier's own CHECK constraint in services/migrations.ts. */
const DENIER_MIN = 5;
const DENIER_MAX = 270;

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

/** An item may carry at most this many materials — see MultiSelectField's maxSelected in components/Form.tsx. */
export const MAX_MATERIALS = 2;

function parseMaterialList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const matched = new Set<string>();
  for (const entry of value) {
    const material = matchVocabulary(entry, ALL_MATERIALS);
    if (material) matched.add(material);
  }
  if (matched.size === 0) return undefined;

  // A spoken description naming three or more materials still only keeps the
  // first MAX_MATERIALS in ALL_MATERIALS' own order — matched is unordered, so
  // filtering ALL_MATERIALS first is what makes "first" mean something
  // consistent rather than depending on Set iteration order.
  return ALL_MATERIALS.filter((material) => matched.has(material)).slice(0, MAX_MATERIALS);
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

/**
 * Reads a denier value, rejecting rather than clamping — unlike
 * parseScaleEstimate's warmth/wind estimates, denier is a real garment
 * label the model either heard correctly or did not, so a wildly
 * out-of-range answer (negative, or absurdly large) is more likely a
 * misheard number than a true denier worth keeping a distorted version of.
 */
function parseDenier(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= DENIER_MIN && rounded <= DENIER_MAX ? rounded : undefined;
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

  const sleeveLength = matchVocabulary(source.sleeveLength, SLEEVE_LENGTHS);
  if (sleeveLength !== null) proposal.sleeveLength = sleeveLength;

  const thickness = matchVocabulary(source.thickness, THICKNESSES);
  if (thickness !== null) proposal.thickness = thickness;

  // Pants and Skirt each have their own length vocabulary (see
  // GarmentLength), so — unlike sleeveLength, one flat list — this can only
  // be checked once category is known. category is required in the
  // extraction schema (services/voice.ts), so it's present on every
  // well-formed reply; a malformed one simply means length goes unheard too.
  if (category !== null) {
    const length = matchVocabulary(source.length, lengthOptionsFor(category));
    if (length !== null) proposal.length = length;
  }

  // Rejects malformed shape the same way every other field here does — an
  // empty string means "the description implied no timeframe", which is the
  // same as not proposing the field at all, so both become undefined.
  if (typeof source.purchasedAt === 'string') {
    const purchasedAt = parsePurchasedAtMonth(source.purchasedAt);
    if (purchasedAt) proposal.purchasedAt = purchasedAt;
  }
}

/** Cost, condition and the warmth/wind estimates — the quantity fields. */
function applyQuantityFields(source: Record<string, unknown>, proposal: ItemProposal): void {
  const costMinorUnits = parseCostInPounds(source.costInPounds);
  if (costMinorUnits !== undefined) proposal.costMinorUnits = costMinorUnits;

  const isSecondHand = parseBoolean(source.isSecondHand);
  if (isSecondHand !== undefined) proposal.isSecondHand = isSecondHand;

  const hasBeltLoops = parseBoolean(source.hasBeltLoops);
  if (hasBeltLoops !== undefined) proposal.hasBeltLoops = hasBeltLoops;

  const backless = parseBoolean(source.backless);
  if (backless !== undefined) proposal.backless = backless;

  const denier = parseDenier(source.denier);
  if (denier !== undefined) proposal.denier = denier;

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
