import { SCALE_MAX } from './format';
import type { Category, GarmentLength, SleeveLength, Thickness } from '../types/wardrobe';

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
 *  - Materials do not stack unweighted. Once the user has assigned real
 *    percentages (see MaterialEntry in types/wardrobe.ts), materialAdjustment
 *    takes a weighted average of just the entries with a percentage
 *    recorded, ignoring any that don't — so "60% wool, unlabeled 20%
 *    polyester" reads as wool's own adjustment discounted toward neutral by
 *    the 40% of the garment that isn't wool, not diluted by an unlabeled
 *    remainder pretending to be something specific. Until a percentage is
 *    recorded at all, this falls back to dominantAdjustment: the single most
 *    significant material's adjustment, unweighted — a wool/polyester blend
 *    with no percentages reads as wool, not as wool-plus-polyester summed.
 *    Either way, a wardrobe item with several insulating fibres listed is
 *    never simply their adjustments added together; a sum-based model said
 *    otherwise, which is how a lightly-insulated garment with several
 *    materials tagged could reach the top of the scale.
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
  // A thinner, close-knit relative of Pants: less bulk to trap air and
  // typically a stretch knit rather than a woven fabric, so both baseline
  // and ceiling sit below Pants even before a material is chosen.
  Leggings: { warmth: { baseline: 2, max: 6 }, wind: { baseline: 1, max: 5 } },
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
  // A taller, typically more insulated relative of Shoes: same closed
  // construction (so the same near-binary wind-blocking baseline), but the
  // ankle/shin coverage and heavier materials boots are usually made from
  // push both the warmth baseline and ceiling above plain Shoes.
  Boots: { warmth: { baseline: 3, max: 7 }, wind: { baseline: 8, max: 10 } },
  // Open by design — there is no upper to block wind or trap warmth, unlike
  // closed Shoes. The ceiling is 0, not just the baseline: no material makes
  // an open sandal windproof or warm.
  Sandals: { warmth: { baseline: 0, max: 0 }, wind: { baseline: 0, max: 0 } },
  Belt: { warmth: { baseline: 0, max: 0 }, wind: { baseline: 0, max: 0 } },
  Bag: { warmth: { baseline: 0, max: 0 }, wind: { baseline: 0, max: 0 } },
  Scarf: { warmth: { baseline: 3, max: 7 }, wind: { baseline: 2, max: 6 } },
  // Sheer to opaque legwear worn under a Skirt or Dress, not a Bottom in its
  // own right (see the Category doc comment in types/wardrobe.ts) — thin by
  // nature, so baseline stays low relative to Leggings. Warmth's ceiling was
  // raised from an earlier 3 to make room for DENIER_WARMTH_ADJUSTMENT below:
  // a sheer 5D pair and a fleece-lined 270D wool-blend pair are not close to
  // equally warm, and 3 left no headroom to tell them apart. Wind's ceiling
  // stays low — denier is a warmth question (how much air a knit traps), not
  // a wind one; sheer-to-opaque legwear never becomes wind-blocking the way a
  // woven or coated fabric can, however dense the knit.
  Tights: { warmth: { baseline: 1, max: 8 }, wind: { baseline: 0, max: 2 } },
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
  // A point below Wool: both are genuine insulating fibres, but alpaca's
  // straighter, smoother hair traps less air per unit weight than wool's
  // crimped structure does.
  Alpaca: 2,
  Canvas: 1,
  Cashmere: 3,
  Corduroy: 1,
  Denim: 1,
  Down: 4,
  Fleece: 3,
  Fur: 4,
  // Faux Leather has no entry here — a coated synthetic film has no
  // insulating fibre of its own the way real hide does (see Leather above
  // and its own wind-adjustment comment below), so it reads as
  // warmth-neutral, the same as Nylon or Polyester, not as a positive
  // entry like Leather or a negative one like Linen.
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
 * Leather. Faux Leather matches Leather exactly here even though it carries
 * no warmth adjustment above: a coated synthetic film blocks moving air just
 * as completely as a real hide does — wind-blocking is about the surface
 * being continuous and non-porous, which the coating provides regardless of
 * what's underneath it, unlike warmth, which depends on genuine insulating
 * fibre a synthetic film doesn't have.
 */
const MATERIAL_WIND_ADJUSTMENT: Partial<Record<string, number>> = {
  // A point below Wool's neutral baseline: alpaca's hollow, less densely
  // packed fibre lets slightly more wind through than wool's tighter one.
  Alpaca: -1,
  Canvas: 1,
  Corduroy: 1,
  Denim: 1,
  Down: 1,
  'Faux Leather': 6,
  Fleece: -1,
  Fur: 4,
  Leather: 6,
  Linen: -1,
  Mohair: -1,
  Nylon: 2,
  // Polyamide is chemically the same fibre marketed as Nylon under a
  // different name, so it carries the identical wind adjustment.
  Polyamide: 2,
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
 *
 * Leggings' own vocabulary (LeggingsLength) reuses Pants' 'Short'/'Capri'/
 * 'Long' string values and Skirt's 'Knee-length', rather than adding four
 * more entries here: the physical meaning of each step (how much leg it
 * covers) is the same regardless of which garment it's attached to, so a
 * shared value under a shared key is correct, not an oversight — see
 * LeggingsLength's own doc comment in types/wardrobe.ts.
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
 * How much fabric thickness shifts warmth, independent of category or
 * material — a mesh tank and a heavy cable-knit jumper are both 'Top'-group
 * items the category/material system alone can't tell apart. 'Regular' is
 * neutral, the same role 'Short' plays for sleeveLength. Applies to every
 * category (adds on top of the material's dominant adjustment, sleeve and
 * length the same way those already add on top of each other), not gated
 * the way length or denier are — a category with a 0 ceiling (Sandals, Belt,
 * Bag) simply clamps the result back to 0 regardless, the same as every
 * other adjustment already does.
 *
 * A conservative ±1-per-step scale, deliberately smaller than sleeve length
 * or garment length's own steps: thickness nudges warmth, it doesn't
 * dominate it the way a strong material (Wool, Down) or a coverage change
 * (sleeveless, a mini skirt) can.
 */
const THICKNESS_WARMTH_ADJUSTMENT: Record<Thickness, number> = {
  Mesh: -2,
  Light: -1,
  Regular: 0,
  Thick: 1,
  Heavy: 2,
};

/** Denier below which the formula floors at 0 — real hosiery starts around here (sheer). */
const DENIER_MIN = 5;
/** Denier above which the formula stops rising — fleece-lined tights top out around here. */
const DENIER_MAX = 270;
/**
 * The most a denier value alone can add to Tights' warmth — deliberately
 * less than the room CATEGORY_RANGE's raised Tights ceiling actually leaves
 * (baseline 1 + this 4 = 5, against a ceiling of 8): the remaining headroom
 * is what MATERIAL_WARMTH_ADJUSTMENT's own Wool/Fleece entries fill in for a
 * genuinely wool-blend or fleece-lined pair, on top of this, the same way
 * every other adjustment here adds rather than competes. A pure-synthetic
 * 270D tight is meaningfully warmer than a sheer one, but it is not, on its
 * own, as warm as a wool-blend pair at the same denier — the whole point of
 * scaling denier sublinearly below.
 */
const DENIER_WARMTH_CAP = 4;

/**
 * Denier's warmth contribution, 0 at DENIER_MIN rising to DENIER_WARMTH_CAP
 * at DENIER_MAX — 0 (not recorded, see the denier doc comment in
 * types/wardrobe.ts) is also 0 here, the same "unset reads as neutral"
 * convention length and sleeveLength already use.
 *
 * A square-root curve, not linear: denier measures how tightly a synthetic
 * yarn is woven, and most of the real warmth gain happens in the sheer-to-
 * opaque range (roughly 5-100D) where a knit goes from "barely there" to
 * "actually opaque" — a 40D-to-100D jump matters far more to how warm
 * tights feel than a 200D-to-270D one does, where the knit is already dense
 * and further denier mostly adds bulk, not meaningfully more trapped air.
 * Linear scaling would understate the low end and overstate the high one.
 */
function denierWarmthAdjustment(denier: number): number {
  if (denier <= 0) return 0;
  const clamped = Math.min(DENIER_MAX, Math.max(DENIER_MIN, denier));
  const progress = (clamped - DENIER_MIN) / (DENIER_MAX - DENIER_MIN);
  return Math.round(DENIER_WARMTH_CAP * Math.sqrt(progress));
}

/**
 * A backless Top or Dress opens the same kind of direct gap in coverage
 * sleeveless already accounts for, just at the back rather than the arms —
 * same -1 warmth step as SLEEVE_WARMTH_ADJUSTMENT's Sleeveless entry, and
 * the same "costs some insulation, not all of it" reasoning. Wind takes a
 * slightly larger hit, matching SLEEVE_WIND_ADJUSTMENT's own gap between its
 * warmth and wind steps for the same reason: an open back is a direct path
 * for moving air. Trusts `backless` the way denier trusts its own value —
 * callers already clear it to false for a category backlessApplies rejects
 * (see ItemDetailsScreen's buildItemUpdate and AddItemScreen's
 * withDefaults), so this needs no category check of its own.
 */
const BACKLESS_WARMTH_ADJUSTMENT = -1;
const BACKLESS_WIND_ADJUSTMENT = -2;

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

/**
 * The material contribution for a given dimension: a weighted average of
 * whichever of `materials` actually carries a recorded percentage in
 * `percents` (percent > 0 — see MaterialEntry's own doc comment for why 0
 * means "not recorded", not "0% of the garment"), falling back to
 * dominantAdjustment, unweighted, once none do — which is every item added
 * before material percentages existed, and any new one where the user
 * picked materials but left both percentages blank. See the module doc
 * comment's first bullet for the full reasoning.
 *
 * `percents` is a lookup, not a parallel MaterialEntry[], deliberately: it
 * keeps `materials` itself a plain string[] throughout this file (and its
 * public estimateWarmth/estimateWind signatures), the same shape every
 * caller and every existing test already passes, rather than forcing every
 * caller that doesn't have percentages at hand — the overwhelming majority,
 * including this file's own tests — to wrap a bare material name in an
 * object just to satisfy a type it never uses.
 */
function materialAdjustment(
  materials: readonly string[],
  percents: Partial<Record<string, number>>,
  table: Partial<Record<string, number>>,
): number {
  const weighted = materials.filter((material) => (percents[material] ?? 0) > 0);
  if (weighted.length === 0) return dominantAdjustment(materials, table);

  const totalPercent = weighted.reduce((sum, material) => sum + (percents[material] ?? 0), 0);
  const weightedSum = weighted.reduce(
    (sum, material) => sum + (percents[material] ?? 0) * (table[material] ?? 0),
    0,
  );
  return weightedSum / totalPercent;
}

function estimate(
  category: Category,
  materials: readonly string[],
  percents: Partial<Record<string, number>>,
  sleeveLength: SleeveLength,
  length: GarmentLength | '',
  rangeOf: (ranges: { warmth: ScaleRange; wind: ScaleRange }) => ScaleRange,
  materialTable: Partial<Record<string, number>>,
  sleeveTable: Record<SleeveLength, number>,
  lengthTable: Partial<Record<GarmentLength, number>>,
  // Thickness and denier are warmth-only (see THICKNESS_WARMTH_ADJUSTMENT and
  // denierWarmthAdjustment's own doc comments for why); estimateWind always
  // passes 0 for both rather than this function needing a second thickness
  // table and a second denier formula it would never actually use.
  extraAdjustment: number = 0,
): number {
  const { baseline, max } = rangeOf(CATEGORY_RANGE[category]);
  const materialsAdjustment = materialAdjustment(materials, percents, materialTable);
  const sleeveAdjustment = sleeveTable[sleeveLength];
  const lengthAdjustment = length === '' ? 0 : (lengthTable[length] ?? 0);
  const raw = Math.round(baseline + materialsAdjustment + sleeveAdjustment + lengthAdjustment + extraAdjustment);
  return Math.min(SCALE_MAX, Math.min(max, Math.max(0, raw)));
}

/**
 * Estimated inferredWarmth for a garment of this category, materials, sleeve
 * length, garment length, thickness and (for Tights) denier. `sleeveLength`
 * defaults to 'Short' and `length` defaults to '' (both neutral) for
 * categories where they do not apply; `thickness` defaults to 'Regular'
 * (also neutral); `denier` defaults to 0 (not recorded, also neutral) —
 * callers that already store normalized values (see ItemDetailsScreen's
 * buildItemUpdate) can just pass them straight through.
 *
 * `materialPercents` defaults to `{}` (no recorded percentages, so the
 * dominant-material rule applies unweighted) and comes last, after every
 * other already-established parameter, purely so it never shifts any of
 * their positions for an existing positional call — see
 * materialAdjustment's own doc comment for why this is a name-keyed lookup,
 * not the item's MaterialEntry[] directly. Building one from an item's own
 * materials is a caller's job (see AttributeList.tsx/ItemDetailsScreen.tsx
 * for the `Object.fromEntries` one-liner), so this file's own tests, and
 * every caller that only cares about which materials are present, can keep
 * passing a plain string[] and never touch this parameter at all.
 */
export function estimateWarmth(
  category: Category,
  materials: readonly string[],
  sleeveLength: SleeveLength = 'Short',
  length: GarmentLength | '' = '',
  thickness: Thickness = 'Regular',
  denier: number = 0,
  materialPercents: Partial<Record<string, number>> = {},
  backless: boolean = false,
): number {
  return estimate(
    category,
    materials,
    materialPercents,
    sleeveLength,
    length,
    (r) => r.warmth,
    MATERIAL_WARMTH_ADJUSTMENT,
    SLEEVE_WARMTH_ADJUSTMENT,
    LENGTH_WARMTH_ADJUSTMENT,
    THICKNESS_WARMTH_ADJUSTMENT[thickness] +
      denierWarmthAdjustment(denier) +
      (backless ? BACKLESS_WARMTH_ADJUSTMENT : 0),
  );
}

/**
 * Estimated inferredWind for a garment of this category, materials, sleeve
 * length and garment length. No `materialPercents` parameter: wind stays on
 * the unweighted dominant-material rule regardless — see the module doc
 * comment's first bullet, which is specifically about warmth.
 */
export function estimateWind(
  category: Category,
  materials: readonly string[],
  sleeveLength: SleeveLength = 'Short',
  length: GarmentLength | '' = '',
  backless: boolean = false,
): number {
  return estimate(
    category,
    materials,
    {},
    sleeveLength,
    length,
    (r) => r.wind,
    MATERIAL_WIND_ADJUSTMENT,
    SLEEVE_WIND_ADJUSTMENT,
    LENGTH_WIND_ADJUSTMENT,
    backless ? BACKLESS_WIND_ADJUSTMENT : 0,
  );
}
