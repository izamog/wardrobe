import type { Category, ClothingItem } from '../types/wardrobe';

/**
 * A .png is a background-removal cutout (see StoredImage); a .jpg still has
 * its background. Case-insensitive to match isPng in services/images.ts,
 * the other place a stored path's format is sniffed this way.
 */
export function isCutout(path: string): boolean {
  return path.toLowerCase().endsWith('.png');
}

/**
 * The collage canvas is a 5x5 grid on a 3:4 (width:height) canvas, per an
 * explicit design spec: columns A-E left to right, rows 1-5 top to bottom,
 * tile name is `<column><row>` (e.g. "D2"). "N boxes wide" means N/5 of the
 * canvas *width*; "N boxes tall" means N/5 of the canvas *height" — the two
 * are different absolute fractions whenever N isn't compared against the
 * same axis, since only the grid (and each of its cells) is 3:4, not a
 * literal 1:1 box.
 *
 * All coordinates below are percentages of the canvas (0-100).
 */
const BOX = 20; // one grid box, as a percentage of either axis (100 / 5)

const COLUMN_CENTER = { A: 10, B: 30, C: 50, D: 70, E: 90 };
const ROW_CENTER = { '1': 10, '2': 30, '3': 50, '4': 70, '5': 90 };
const COLUMN_DIVIDER = { AB: 20, BC: 40, CD: 60, DE: 80 };
const ROW_DIVIDER = { '12': 20, '23': 40, '34': 60, '45': 80 };

/**
 * A box sized and positioned per the grid spec, as a percentage rect plus a
 * stacking order. Two shapes:
 *
 *  - "Contain" items (Jacket, Dress) are given both a width and a height cap
 *    — exactly the box RN's Image resizeMode="contain" already fits an
 *    image within, so specifying the cap is enough; no per-image
 *    aspect-ratio math is needed here. This is only right for a category
 *    whose spec is genuinely "expand to X or Y, whichever comes first" —
 *    Top and Sweater/Cardigan used to be modelled this way too, but a
 *    portrait-oriented garment cutout routinely hit the height cap before
 *    reaching the stated width, silently rendering narrower than specified
 *    (see git history / outfitCollageLayout.test.ts). They're width-only now.
 *  - "Width-only" items (everything else) only have their sizing axis
 *    genuinely constrained. The cross axis is given a box spanning the full
 *    canvas along that axis, centered on the item's target coordinate —
 *    this guarantees the stated width (or height, for Dress) is always the
 *    true binding constraint, never accidentally capped by an insufficient
 *    cross-axis allowance, while resizeMode="contain" still centers the
 *    fitted image at exactly the intended point.
 */
export interface SlotRect {
  top: number;
  left: number;
  width: number;
  height: number;
  z: number;
}

/** left/top such that a box of the given size is centered on (x, y). */
function centeredBox(x: number, y: number, width: number, height: number, z: number): SlotRect {
  return { left: x - width / 2, top: y - height / 2, width, height, z };
}

/**
 * A generous cross-axis size for "width-only" items — large enough that no
 * realistic garment cutout's aspect ratio can make the free axis the
 * binding constraint instead of the stated width.
 *
 * This was dropped to 150 on the unverified theory that RN's layout engine
 * might not resolve very large/negative percentages correctly. That theory
 * was never actually confirmed, and it was wrong to act on it: a real device
 * screenshot with the grid overlaid (a T-Shirt and a pair of jeans, both
 * photographed tall and narrow — see outfitCollageLayout.test.ts for the
 * measured numbers) proved the *original* diagnosis right instead — those
 * photos' own aspect ratios are roughly 1:9.5 and narrower, well past what
 * 150 covers, so height was binding before width reached its target and
 * silently shrinking the rendered width, exactly like the original
 * maxi-skirt bug this constant exists to prevent.
 *
 * 1400 covers any image aspect ratio down to roughly 1:40 for the widest
 * (2.3-box) item and narrower still for anything smaller — see the
 * regression tests below, which assert against the actual measured photos
 * rather than a guessed threshold.
 */
const GENEROUS_FREE_AXIS = 1400;

/** A width-only item: exact width, centered horizontally at x; the cross axis is generous (see GENEROUS_FREE_AXIS), centered at y. */
function widthOnlyBox(x: number, width: number, y: number, z: number): SlotRect {
  return centeredBox(x, y, width, GENEROUS_FREE_AXIS, z);
}

// Top/T-Shirt/Shirt and every long bottom used to be sized at 1.25 boxes
// (25%) — visibly smaller on the canvas than Shoes, Coat and Bag (2-2.5
// boxes) despite covering a comparable or larger real amount of the body.
// Widened to match those three's own width, on the same widthOnlyBox
// mechanism they already use (see widthOnlyBox below) — a real garment
// photo's own aspect ratio, not a smaller stated box, is what should ever
// make one of these look smaller than another on the canvas.
//
// Top, T-Shirt and Shirt used to share one width (and one bucket,
// 'genericTop') as "the generic Top" — split into three per explicit
// feedback that they should each read at a different size. Each is now its
// own bucket (see Bucket/BUCKET_BY_CATEGORY below), sized independently.
const TOP_WIDTH = 1.5 * BOX;
const TSHIRT_WIDTH = 2 * BOX;
const SHIRT_WIDTH = 2.5 * BOX;
const DRESS_WIDTH = 1.25 * BOX;
const DRESS_HEIGHT = 3 * BOX;
const BOTTOM_WIDTH = 2 * BOX;
// Jacket and Coat both 2.3 boxes — Jacket used to be a dual-capped "contain"
// box (both width and height stated), the same mechanism Top/Sweater used to
// use before it silently under-sized a portrait-oriented garment cutout that
// hit the height cap before reaching its stated width (see widthOnlyBox's
// own doc comment). Moved onto widthOnlyBox for the same reason, matching
// how Coat already worked.
const JACKET_WIDTH = 2.3 * BOX;
const COAT_WIDTH = 2.3 * BOX;
// Sweater and Cardigan used to share one width (2 boxes) as one 'sweater'
// bucket — split into two per explicit feedback: Sweater widened to 2.3,
// Cardigan explicitly left unchanged at 2.
const SWEATER_WIDTH = 2.3 * BOX;
const CARDIGAN_WIDTH = 2 * BOX;
// Belt widened from 1 box (still too small per feedback) to 1.5 — enough to
// read clearly without matching a full garment's 2-box width, since a belt
// genuinely is a thinner accessory than a top, bottom, bag or coat.
const BELT_WIDTH = 1.5 * BOX;
const BAG_WIDTH = 2 * BOX;
const SCARF_WIDTH = 0.75 * BOX;
// Tights widened from 0.75 to a full box (1 * BOX) per explicit feedback.
const TIGHTS_WIDTH = 1 * BOX;
const SHOES_WIDTH = 2 * BOX;

/** Where a base-layer bucket (Top, T-Shirt or Shirt) centers when no Sweater/Cardigan shares the outfit. */
const TOP_CENTER = { x: COLUMN_CENTER.D, y: ROW_CENTER['2'] };
/** Where it shifts to instead, so it doesn't sit exactly under a Sweater/Cardigan also centered on D2. */
const TOP_CENTER_WITH_SWEATER = { x: COLUMN_DIVIDER.CD, y: ROW_DIVIDER['12'] };

/** The base-layer buckets: Top, T-Shirt and Shirt each get their own width but share the same centering rule — see TOP_WIDTH_BY_BUCKET and baseRectFor. */
type BaseLayerBucket = 'top' | 'tshirt' | 'shirt';
const TOP_WIDTH_BY_BUCKET: Record<BaseLayerBucket, number> = {
  top: TOP_WIDTH,
  tshirt: TSHIRT_WIDTH,
  shirt: SHIRT_WIDTH,
};

/**
 * Stacking order, lowest to highest. Two rules were explicit and in
 * apparent conflict — Bag "on top of everything" and Belt "on top, below
 * nothing" — but they never actually overlap (Bag centers on B3, Belt on
 * the D2/D3 divider), so both simply sit at the top of the stack; Belt one
 * step above Bag purely to honor its stronger "below nothing" wording,
 * with no visible effect since the two never share space.
 */
const Z = {
  outerwear: 2, // Jacket, Coat
  torso: 3, // Top/T-Shirt/Shirt, and the bottom-half garments (shorts/pants/skirts/leggings) — these never overlap each other
  sweater: 4, // Sweater, Cardigan — the outer layer over a Top/T-Shirt/Shirt
  dress: 5, // below Belt, above Top, per spec
  scarf: 6, // "layer above outerwear"
  tights: 7,
  shoes: 8, // "above everything except Bag"
  bag: 9,
  belt: 10, // "below nothing"
};

type Bucket =
  | 'jacket'
  | 'coat'
  | BaseLayerBucket
  | 'sweater'
  | 'cardigan'
  | 'dress'
  | 'shortBottom'
  | 'longBottom'
  | 'shoes'
  | 'belt'
  | 'bag'
  | 'scarf'
  | 'tights';

/** Every category's bucket, except Pants and Skirt — those split on length, handled separately in bucketFor. */
const BUCKET_BY_CATEGORY: Record<Exclude<Category, 'Pants' | 'Skirt'>, Bucket> = {
  Jacket: 'jacket',
  Coat: 'coat',
  'T-Shirt': 'tshirt',
  Top: 'top',
  Shirt: 'shirt',
  Cardigan: 'cardigan',
  Sweater: 'sweater',
  Dress: 'dress',
  // Always short by definition, unlike Pants/Skirt which split on their own
  // length field — see bucketFor.
  Shorts: 'shortBottom',
  Leggings: 'longBottom',
  Shoes: 'shoes',
  Boots: 'shoes',
  Sandals: 'shoes',
  Belt: 'belt',
  Bag: 'bag',
  Scarf: 'scarf',
  Tights: 'tights',
};

/**
 * Which bucket an item's category (and, for Bottoms, its length) falls
 * into. Pants/Skirt split on length: 'Short' Pants and 'Mini' Skirt are the
 * "shorts and mini skirt" rule; every other length (including no length
 * recorded) falls into the "long" rule, per the explicit spec covering
 * "long pants, knee length pants, midi and maxi skirts and leggings" — the
 * short/mini case is the one called out as the exception, not the long one.
 */
function bucketFor(item: ClothingItem): Bucket {
  if (item.category === 'Pants') return item.length === 'Short' ? 'shortBottom' : 'longBottom';
  if (item.category === 'Skirt') return item.length === 'Mini' ? 'shortBottom' : 'longBottom';
  return BUCKET_BY_CATEGORY[item.category];
}

const BASE_LAYER_BUCKETS: ReadonlySet<Bucket> = new Set<BaseLayerBucket>(['top', 'tshirt', 'shirt']);

/** The base (pre-cascade) box for every bucket except the base-layer ones (Top/T-Shirt/Shirt), which also depend on whether a Sweater/Cardigan shares the outfit — see baseRectFor. */
const STATIC_BASE_RECT: Record<Exclude<Bucket, BaseLayerBucket>, SlotRect> = {
  jacket: widthOnlyBox(COLUMN_CENTER.B, JACKET_WIDTH, ROW_CENTER['2'], Z.outerwear),
  // Anchored on the B2/B3 divider, not B3's own center — a coat is meant to
  // straddle the jacket's slot and the bag's slot below it, not sit fully
  // inside either.
  coat: widthOnlyBox(COLUMN_CENTER.B, COAT_WIDTH, ROW_DIVIDER['23'], Z.outerwear),
  sweater: widthOnlyBox(COLUMN_CENTER.D, SWEATER_WIDTH, ROW_CENTER['2'], Z.sweater),
  cardigan: widthOnlyBox(COLUMN_CENTER.D, CARDIGAN_WIDTH, ROW_CENTER['2'], Z.sweater),
  dress: centeredBox(COLUMN_CENTER.D, ROW_CENTER['3'], DRESS_WIDTH, DRESS_HEIGHT, Z.dress),
  // Vertical center on the D3/D4 divider, same as longBottom — shorts used
  // to center on row 3 alone, which read as sitting higher than every other
  // bottom-half garment for no real reason.
  shortBottom: widthOnlyBox(COLUMN_CENTER.D, BOTTOM_WIDTH, ROW_DIVIDER['34'], Z.torso),
  longBottom: widthOnlyBox(COLUMN_CENTER.D, BOTTOM_WIDTH, ROW_DIVIDER['34'], Z.torso),
  shoes: widthOnlyBox(COLUMN_CENTER.B, SHOES_WIDTH, ROW_DIVIDER['45'], Z.shoes),
  belt: widthOnlyBox(COLUMN_CENTER.D, BELT_WIDTH, ROW_DIVIDER['23'], Z.belt),
  bag: widthOnlyBox(COLUMN_CENTER.B, BAG_WIDTH, ROW_CENTER['3'], Z.bag),
  scarf: widthOnlyBox(COLUMN_DIVIDER.AB, SCARF_WIDTH, ROW_CENTER['2'], Z.scarf),
  tights: widthOnlyBox(COLUMN_CENTER.E, TIGHTS_WIDTH, ROW_CENTER['4'], Z.tights),
};

/** The base (pre-cascade) box for a bucket, given whether a Sweater/Cardigan is also in the outfit (only affects the base-layer buckets: Top/T-Shirt/Shirt). */
function baseRectFor(bucket: Bucket, hasSweaterLayer: boolean): SlotRect {
  if (!BASE_LAYER_BUCKETS.has(bucket)) return STATIC_BASE_RECT[bucket as Exclude<Bucket, BaseLayerBucket>];
  const center = hasSweaterLayer ? TOP_CENTER_WITH_SWEATER : TOP_CENTER;
  return widthOnlyBox(center.x, TOP_WIDTH_BY_BUCKET[bucket as BaseLayerBucket], center.y, Z.torso);
}

/**
 * Fraction of a bucket's own width each extra item sharing it is nudged
 * down-right and shrunk by, so multiple items in one bucket — e.g. a Base
 * Layer tee chosen alongside a T-Shirt also filling the main Top slot, both
 * landing in the 'tshirt' bucket — read as a small cascade of layered
 * pieces rather than exact duplicates stacked on top of each other. Top,
 * T-Shirt and Shirt are separate buckets now (see BUCKET_BY_CATEGORY), so a
 * Base Layer tee alongside a *different*-category main Top (a Top or Shirt)
 * no longer shares a bucket at all — each renders at its own bucket's base
 * rect independently, same as any other pair of unrelated categories.
 * Every other bucket only ever holds one item per outfit (buildSlots picks
 * at most one candidate per category), so this is a no-op for them.
 */
const CASCADE_STAGGER_FRACTION = 0.12;
const CASCADE_SHRINK_FRACTION = 0.1;

/**
 * Both offset and shrink are computed from `base.width`, deliberately never
 * `base.height`: a width-only bucket's height is GENEROUS_FREE_AXIS, an
 * artificial value hundreds of percent tall that exists purely so
 * resizeMode="contain" never binds on it (see widthOnlyBox) — staggering by
 * a fraction of that would offset a cascaded item by hundreds of percent
 * instead of a few, which is what using base.height here used to do before
 * Top and Sweater/Cardigan moved off the dual-capped "contain" box.
 */
function cascadeWithinBucket(base: SlotRect, count: number): SlotRect[] {
  return Array.from({ length: count }, (_, i) => {
    // Earlier items sit further back: smaller and offset less, so the last
    // item (visually the outermost layer) is both the largest and drawn on
    // top.
    const depth = count - 1 - i;
    const offset = depth * CASCADE_STAGGER_FRACTION * base.width;
    const shrink = 1 - depth * CASCADE_SHRINK_FRACTION;
    return {
      top: base.top + offset,
      left: base.left + offset,
      width: base.width * shrink,
      height: base.height * shrink,
      z: base.z + i,
    };
  });
}

/**
 * The full collage placement for a set of outfit items: one SlotRect per
 * item, in the same order as `items` — see bucketFor for which bucket each
 * category lands in, baseRectFor for where that bucket sits on the grid,
 * and cascadeWithinBucket for what happens when more than one item shares
 * a bucket.
 */
export function collageLayout(items: readonly ClothingItem[]): SlotRect[] {
  const byBucket = new Map<Bucket, ClothingItem[]>();
  for (const item of items) {
    const bucket = bucketFor(item);
    const existing = byBucket.get(bucket);
    if (existing) existing.push(item);
    else byBucket.set(bucket, [item]);
  }

  const hasSweaterLayer = byBucket.has('sweater') || byBucket.has('cardigan');

  const rectById = new Map<string, SlotRect>();
  for (const [bucket, bucketItems] of byBucket) {
    const base = baseRectFor(bucket, hasSweaterLayer);
    cascadeWithinBucket(base, bucketItems.length).forEach((rect, i) => rectById.set(bucketItems[i].id, rect));
  }

  return items.map((item) => {
    const rect = rectById.get(item.id);
    if (!rect) throw new Error(`No collage rect computed for item ${item.id}`);
    return rect;
  });
}
