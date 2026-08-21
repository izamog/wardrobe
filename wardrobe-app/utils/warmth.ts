import { SCALE_MAX } from './format';
import type { Category, GarmentLength, SleeveLength } from '../types/wardrobe';

/**
 * Estimating inferredWarmth and inferredWind from what is already known about
 * an item — its category and materials — rather than a free-floating guess.
 *
 * Deliberately deterministic rather than AI-estimated: the outfit generator's
 * correctness depends on these numbers being trustworthy and reproducible, an
 * AI call would add network cost and latency to every item added, and a table
 * is something this file's own tests can pin down exactly. See
 * screens/AddItemScreen.tsx and services/voice.ts for where this fills the gap
 * voice extraction leaves.
 *
 * Warmth and wind are deliberately two separate tables, not one combined
 * "insulation" score: a material can be warm without blocking wind. A wool
 * cardigan is the standing example — Wool carries a strong warmth adjustment
 * from trapped air in the fibre, but its wind adjustment is 0, because a knit
 * is porous and does not block moving air the way a tight weave or a coated
 * shell does. Fleece is the same story from the other direction: warm, and
 * notoriously not wind-blocking, which is why outdoor layering systems pair it
 * with a separate shell. The outfit generator's dual-target check (warmth AND
 * wind must each clear their own threshold) is what turns that distinction
 * into something that actually changes which outfit gets recommended.
 *
 * Three structural rules keep this bounded and physically defensible, not
 * just clamped after the fact:
 *  - Materials do not stack. Only the single most significant material's
 *    adjustment is applied (see dominantAdjustment) — a wool/polyester blend
 *    reads as wool, not as wool-plus-polyester summed. A wardrobe item with
 *    three insulating fibres listed is not three times as warm as one; a
 *    sum-based model said otherwise, which is how a lightly-insulated garment
 *    with several materials tagged could reach the top of the scale.
 *  - Every category carries a ceiling, not just a baseline. Coverage and
 *    construction are facts about the category, not the fabric — a sleeveless
 *    Top cannot be made as warm as a Coat by fabric choice alone, so its
 *    ceiling says so directly rather than hoping baseline-plus-adjustment
 *    never wanders somewhere implausible.
 *  - Sleeve length is a second, independent coverage axis from category.
 *    'Top' alone spans a sleeveless tank and a loose long-sleeve jersey top,
 *    which are not close to equally warm — see SLEEVE_WARMTH_ADJUSTMENT. It
 *    adds on top of the material's dominant adjustment rather than competing
 *    with it: coverage and fabric are different physical facts about the
 *    garment, not two readings of the same one, so there's no double-counting
 *    risk the way stacking several materials would have.
 *  - Garment length is the same kind of axis, for Pants and Skirt — see
 *    LENGTH_WARMTH_ADJUSTMENT. A pair of shorts and a pair of full-length
 *    trousers share a category but cover very different amounts of leg, and
 *    a mini skirt and a maxi skirt are not close to equally warm either. Like
 *    sleeve length, it adds on top of the material's dominant adjustment
 *    rather than competing with it, and it is neutral (0) for every category
 *    the field does not apply to, and for '' (not recorded) — see the
 *    GarmentLength doc comment in types/wardrobe.ts for why length has no
 *    single shared neutral value the way sleeveLength's 'Short' does.
 */

interface ScaleRange {
  /** Value with no notable material present. */
  baseline: number;
  /** Highest value this category can reach, however insulating the material. */
  max: number;
}

/**
 * A single garment's baseline and ceiling for warmth and wind resistance, on
 * the same 0-10 scale as inferredWarmth/inferredWind.
 *
 * Typed as a total Record over Category, so adding a Category without giving
 * it a range is a compile error rather than a silent gap — the same
 * discipline CATEGORY_GROUP in utils/categories.ts uses.
 *
 * Warmth reflects how insulating the garment is as a layer on its own body
 * area (a Coat is a heavy outer layer; a T-Shirt is not). Wind reflects how
 * much the garment's own construction blocks moving air, independent of
 * warmth (a Jacket's shell blocks wind even before its material is counted;
 * a Sweater's knit mostly doesn't).
 */
const CATEGORY_RANGE: Record<Category, { warmth: ScaleRange; wind: ScaleRange }> = {
  'T-Shirt': { warmth: { baseline: 1, max: 4 }, wind: { baseline: 0, max: 3 } },
  // Doc'd elsewhere as covering vests, camisoles and tanks as well as plain
  // tops — sleeveless and minimal-coverage by definition, which is exactly
  // why its ceiling stays low regardless of what fabric is selected.
  Top: { warmth: { baseline: 1, max: 4 }, wind: { baseline: 0, max: 3 } },
  Shirt: { warmth: { baseline: 2, max: 5 }, wind: { baseline: 1, max: 4 } },
  Cardigan: { warmth: { baseline: 4, max: 7 }, wind: { baseline: 1, max: 4 } },
  Sweater: { warmth: { baseline: 5, max: 8 }, wind: { baseline: 1, max: 4 } },
  Jacket: { warmth: { baseline: 5, max: 9 }, wind: { baseline: 4, max: 10 } },
  Coat: { warmth: { baseline: 7, max: 10 }, wind: { baseline: 5, max: 10 } },
  // A single layer that replaces both a Top and a Bottom, so it covers more
  // body area than either alone — slightly warmer than a plain Top, but
  // still a single unlined layer, nowhere near a Bottom-plus-Top total.
  Dress: { warmth: { baseline: 2, max: 5 }, wind: { baseline: 1, max: 4 } },
  Pants: { warmth: { baseline: 3, max: 7 }, wind: { baseline: 2, max: 8 } },
  // Lower baseline and ceiling than Pants: a skirt covers less leg surface
  // than trousers (no coverage below the hem at all, whatever the hem's
  // length) and is typically a lighter-weight single layer of fabric.
  Skirt: { warmth: { baseline: 2, max: 6 }, wind: { baseline: 1, max: 7 } },
  // Wind is a near-binary question for footwear: a closed shoe's sole and
  // upper block moving air regardless of what the upper is made of, unlike a
  // garment where weave and fibre genuinely change how much air gets
  // through. So the baseline itself sits high — any non-sandal shoe reads as
  // wind-resistant — rather than relying on a material bump to get there.
  // Warmth stays comparatively low: feet lose real heat, but nowhere near
  // what an exposed torso does, which is also why utils/outfitGenerator.ts
  // weights the outfit-level total by body region on top of this.
  Shoes: { warmth: { baseline: 1, max: 4 }, wind: { baseline: 8, max: 10 } },
  // Open by design — there is no upper to block wind or trap warmth, unlike
  // closed Shoes. The ceiling is 0, not just the baseline: no material makes
  // an open sandal windproof or warm.
  Sandals: { warmth: { baseline: 0, max: 0 }, wind: { baseline: 0, max: 0 } },
  Belt: { warmth: { baseline: 0, max: 0 }, wind: { baseline: 0, max: 0 } },
  Bag: { warmth: { baseline: 0, max: 0 }, wind: { baseline: 0, max: 0 } },
  Scarf: { warmth: { baseline: 3, max: 7 }, wind: { baseline: 2, max: 6 } },
};

/**
 * How much a garment's single most significant material shifts warmth and
 * wind resistance from the category baseline. Absent from either map means
 * "no adjustment", not "unknown" — most materials are warmth/wind-neutral
 * relative to the garment they're used in.
 *
 * Negative entries are as meaningful as positive ones: Linen and Satin are
 * cooling relative to an unremarkable fabric, and a loosely-woven fibre like
 * Mohair lets more wind through than the category baseline already assumes,
 * not less.
 */
const MATERIAL_WARMTH_ADJUSTMENT: Partial<Record<string, number>> = {
  Acrylic: 1,
  Alpaca: 3,
  Cashmere: 3,
  Corduroy: 1,
  Denim: 1,
  Down: 4,
  Fleece: 3,
  Leather: 1,
  Linen: -1,
  Merino: 2,
  Mohair: 2,
  Satin: -1,
  Sheepskin: 4,
  Silk: 1,
  Suede: 1,
  Tweed: 2,
  Velvet: 1,
  Wool: 3,
};

/**
 * Wind adjustments are independent of the warmth table above — see the module
 * doc comment. Wool and Fleece are the two entries worth reading twice: both
 * carry a strong positive warmth adjustment and a non-positive wind one.
 *
 * Leather is the other direction of the same point: a smooth hide is not
 * merely wind-resistant like a tightly-woven fabric, it is close to airtight,
 * which is why its adjustment sits well above Nylon's rather than a notch
 * above it. Suede and Sheepskin are leather-family but napped or wool-backed,
 * so some air still passes through the surface — high, but below plain
 * Leather.
 */
const MATERIAL_WIND_ADJUSTMENT: Partial<Record<string, number>> = {
  Corduroy: 1,
  Denim: 1,
  Down: 1,
  Fleece: -1,
  Leather: 6,
  Linen: -1,
  Mohair: -1,
  Nylon: 2,
  Polyester: 1,
  Sheepskin: 4,
  Suede: 4,
  Wool: 0,
};

/**
 * How much sleeve coverage shifts warmth and wind resistance, independent of
 * fabric. 'Short' is neutral — see the SleeveLength doc comment in
 * types/wardrobe.ts for why that's also the migration default. Wind moves
 * more than warmth for the sleeveless case specifically: bare arms are a
 * large, direct opening to moving air in a way that mostly costs a garment
 * some insulation, not all of it.
 */
const SLEEVE_WARMTH_ADJUSTMENT: Record<SleeveLength, number> = {
  Sleeveless: -1,
  Short: 0,
  Long: 1,
};

const SLEEVE_WIND_ADJUSTMENT: Record<SleeveLength, number> = {
  Sleeveless: -2,
  Short: 0,
  Long: 1,
};

/**
 * How much leg or skirt coverage shifts warmth and wind resistance,
 * independent of fabric — the same role SLEEVE_WARMTH_ADJUSTMENT plays for
 * sleeves, but for Pants and Skirt's own `length` field.
 *
 * '' (not recorded — see the GarmentLength doc comment) is neutral: a missing
 * answer must not silently read as "Short"/"Mini", the coldest end of either
 * vocabulary. Every caller stores '' for a category length does not apply to
 * (see ItemDetailsScreen's buildItemUpdate and AddItemScreen's withDefaults),
 * the same convention estimateWarmth already relies on for sleeveLength — so,
 * like sleeveLength, this table is not itself gated by category; it trusts
 * the value handed to it has already been normalized.
 *
 * Pants and Skirt each have their own vocabulary and their own neutral
 * point, because "average coverage" means something different for trousers
 * than for a skirt — Pants' midpoint is Capri/Mid-length, roughly knee to
 * mid-calf, while Skirt's is Knee-length, the traditional "ordinary" skirt.
 * Wind moves more than warmth per step, same reasoning as sleeves: exposed
 * leg is a large, direct opening to moving air.
 */
const LENGTH_WARMTH_ADJUSTMENT: Partial<Record<GarmentLength, number>> = {
  // Pants vocabulary, shortest to longest coverage.
  Short: -2,
  'Mid-length': -1,
  Capri: -1,
  Cropped: 0,
  Long: 1,
  // Skirt vocabulary, shortest to longest coverage.
  Mini: -2,
  'Knee-length': -1,
  Midi: 0,
  Maxi: 1,
};

const LENGTH_WIND_ADJUSTMENT: Partial<Record<GarmentLength, number>> = {
  Short: -3,
  'Mid-length': -1,
  Capri: -1,
  Cropped: 0,
  Long: 1,
  Mini: -3,
  'Knee-length': -1,
  Midi: 0,
  Maxi: 1,
};

/**
 * The single most significant material for a given dimension — the one whose
 * adjustment has the largest absolute value — or 0 if none of `materials`
 * carries an entry.
 *
 * Deliberately not a sum: see the module doc comment for why stacking every
 * selected material's adjustment overstates a blend's effect. A material
 * that would pull the result the *other* way (e.g. Linen alongside Wool)
 * does not get netted in either — it simply isn't the most significant one,
 * the same way a small counter-influence in reality doesn't meaningfully
 * offset the fabric that actually dominates a blend's feel.
 */
function dominantAdjustment(
  materials: readonly string[],
  table: Partial<Record<string, number>>,
): number {
  let dominant = 0;
  for (const material of materials) {
    const adjustment = table[material] ?? 0;
    if (Math.abs(adjustment) > Math.abs(dominant)) dominant = adjustment;
  }
  return dominant;
}

function estimate(
  category: Category,
  materials: readonly string[],
  sleeveLength: SleeveLength,
  length: GarmentLength | '',
  rangeOf: (ranges: { warmth: ScaleRange; wind: ScaleRange }) => ScaleRange,
  materialTable: Partial<Record<string, number>>,
  sleeveTable: Record<SleeveLength, number>,
  lengthTable: Partial<Record<GarmentLength, number>>,
): number {
  const { baseline, max } = rangeOf(CATEGORY_RANGE[category]);
  const materialAdjustment = dominantAdjustment(materials, materialTable);
  const sleeveAdjustment = sleeveTable[sleeveLength];
  const lengthAdjustment = length === '' ? 0 : (lengthTable[length] ?? 0);
  const raw = Math.round(baseline + materialAdjustment + sleeveAdjustment + lengthAdjustment);
  return Math.min(SCALE_MAX, Math.min(max, Math.max(0, raw)));
}

/**
 * Estimated inferredWarmth for a garment of this category, materials, sleeve
 * length and garment length. `sleeveLength` defaults to 'Short' (neutral) and
 * `length` defaults to '' (also neutral) for categories where they do not
 * apply — callers that already store a normalized value (see
 * ItemDetailsScreen's buildItemUpdate) can just pass it straight through.
 */
export function estimateWarmth(
  category: Category,
  materials: readonly string[],
  sleeveLength: SleeveLength = 'Short',
  length: GarmentLength | '' = '',
): number {
  return estimate(
    category,
    materials,
    sleeveLength,
    length,
    (r) => r.warmth,
    MATERIAL_WARMTH_ADJUSTMENT,
    SLEEVE_WARMTH_ADJUSTMENT,
    LENGTH_WARMTH_ADJUSTMENT,
  );
}

/** Estimated inferredWind for a garment of this category, materials, sleeve length and garment length. */
export function estimateWind(
  category: Category,
  materials: readonly string[],
  sleeveLength: SleeveLength = 'Short',
  length: GarmentLength | '' = '',
): number {
  return estimate(
    category,
    materials,
    sleeveLength,
    length,
    (r) => r.wind,
    MATERIAL_WIND_ADJUSTMENT,
    SLEEVE_WIND_ADJUSTMENT,
    LENGTH_WIND_ADJUSTMENT,
  );
}
