import { canonicalPair } from '../services/items';
import { getComplementaryCategories, hardwareColorApplies } from './categories';
import { hardwareColorsCompatible } from './hardware';
import { canLayerUnder, isLayerableCategory } from './layering';
import type { ClothingItem } from '../types/wardrobe';

export interface ItemPair {
  key: string;
  a: ClothingItem;
  b: ClothingItem;
}

export const pairKey = (x: string, y: string): string => canonicalPair(x, y).join('|');

/**
 * A belt is only wearable against a Pants or Skirt item that has belt loops
 * (see beltLoopsApply in utils/categories.ts). Without loops, that item
 * cannot wear a belt at all, so pairing one is never a question worth asking.
 */
function clearsBeltLoopRule(a: ClothingItem, b: ClothingItem): boolean {
  const loopable =
    a.category === 'Pants' || a.category === 'Skirt' ? a : b.category === 'Pants' || b.category === 'Skirt' ? b : null;
  const belt = a.category === 'Belt' ? a : b.category === 'Belt' ? b : null;
  return !(loopable && belt && !loopable.hasBeltLoops);
}

/**
 * Where both items carry a hardware finish (only Belt and Bag do, per
 * hardwareColorApplies), the finishes must read as compatible.
 */
function clearsHardwareRule(a: ClothingItem, b: ClothingItem): boolean {
  if (!hardwareColorApplies(a.category) || !hardwareColorApplies(b.category)) return true;
  return hardwareColorsCompatible(a.hardwareColor, b.hardwareColor);
}

/**
 * The one thing a Cardigan is never worn directly against: another Sweater
 * (or another Cardigan, though only one ever reaches a single outfit's own
 * Cardigan slot — see outfitCandidatePools.ts). Two knit mid-layers stacked
 * on the torso is the one combination worth ruling out; deliberately not a
 * wider list — see clearsCardiganLayerRule for the bases this intentionally
 * leaves open.
 */
const CARDIGAN_INCOMPATIBLE_LAYERS: ReadonlySet<ClothingItem['category']> = new Set(['Sweater', 'Cardigan']);

/**
 * A Cardigan must be layered over a real base — a T-Shirt, Top, Shirt or
 * Dress — never worn on its own as the torso's only covering. Explicitly a
 * T-Shirt/Top/Shirt/Dress base list (matching what was asked for), not a
 * delegation to layering.ts's LAYER_PAIRS: that table also disallows Shirt
 * as a Cardigan base, which layers the Speed Matcher's pairing screen relies
 * on but is not this rule's job to enforce — the two are allowed to differ.
 * A Jacket, Coat, Bottom, Shoes, Bag or other non-torso item is unrelated to
 * this rule and passes through untouched; only stacking a Cardigan directly
 * against a Sweater (see CARDIGAN_INCOMPATIBLE_LAYERS) is excluded.
 *
 * The outfit generator's own search (outfitSlots.ts's isCompatibleWithAll)
 * only ever calls isCompatibleCandidate, not getComplementaryCategories, so
 * without this rule here a Cardigan reaching outfitCandidatePools.ts's
 * separate Cardigan slot could still be paired with an incompatible layer
 * underneath it.
 */
function clearsCardiganLayerRule(a: ClothingItem, b: ClothingItem): boolean {
  const cardigan = a.category === 'Cardigan' ? a : b.category === 'Cardigan' ? b : null;
  if (!cardigan) return true;
  const other = cardigan === a ? b : a;
  return !CARDIGAN_INCOMPATIBLE_LAYERS.has(other.category);
}

/**
 * A T-Shirt reaching outfitCandidatePools.ts's Base Layer slot — an extra
 * layer *underneath* whatever fills the main Top slot, not an alternative to
 * it (see baseLayerCandidates) — may only join a torso-relevant item it can
 * actually go under.
 *
 * Unlike clearsCardiganLayerRule, this does delegate to layering.ts's
 * LAYER_PAIRS (canLayerUnder), because the direction here is unambiguous: a
 * T-Shirt used this way is always the innermost layer, which is exactly what
 * that table already encodes, with no known case where this app's own rule
 * needs to disagree with the Speed Matcher's (contrast the Cardigan/Shirt
 * exception clearsCardiganLayerRule exists for). That also means a second
 * T-Shirt, or a plain Top, is correctly rejected as a base-layer partner —
 * neither is something a T-Shirt is ever recorded as going under — which is
 * what stops two same-category items from stacking for no real reason, and
 * what stops the base layer's own T-Shirt pool from also being reachable
 * through a Top/T-Shirt already chosen as the main torso item.
 *
 * A Bottom, Shoes, Bag or other non-torso item has no opinion here
 * (isLayerableCategory), same as clearsCardiganLayerRule's own scoping.
 */
function clearsBaseLayerRule(a: ClothingItem, b: ClothingItem): boolean {
  const tshirt = a.category === 'T-Shirt' ? a : b.category === 'T-Shirt' ? b : null;
  if (!tshirt) return true;
  const other = tshirt === a ? b : a;
  if (other.category === 'T-Shirt') return false;
  if (!isLayerableCategory(other.category)) return true;
  return canLayerUnder('T-Shirt', other.category);
}

/**
 * A backless Top or Dress (see backlessApplies in utils/categories.ts) can
 * never be paired with a T-Shirt, Shirt, Top, Sweater or Cardigan — any of
 * those either shows through the open back or defeats the point of an
 * open-back design being visible at all. A Jacket or Coat over it is fine
 * (not in this set), the same "outerwear is a real exception, base layers
 * are not" distinction clearsCardiganLayerRule draws for its own base list.
 *
 * Checked in both directions: either item in the pair could be the backless
 * one, and if both are (two backless Top/Dress items, however unlikely to
 * ever be complementary categories), each still has to clear the other's
 * own incompatible-layer check.
 */
const BACKLESS_INCOMPATIBLE_LAYERS: ReadonlySet<ClothingItem['category']> = new Set([
  'T-Shirt',
  'Shirt',
  'Top',
  'Sweater',
  'Cardigan',
]);

function clearsBacklessRule(a: ClothingItem, b: ClothingItem): boolean {
  if (a.backless && BACKLESS_INCOMPATIBLE_LAYERS.has(b.category)) return false;
  if (b.backless && BACKLESS_INCOMPATIBLE_LAYERS.has(a.category)) return false;
  return true;
}

/**
 * Whether two items are allowed to appear together as a candidate pair, on
 * top of getComplementaryCategories' category-slot rule.
 */
export function isCompatibleCandidate(a: ClothingItem, b: ClothingItem): boolean {
  return (
    clearsBeltLoopRule(a, b) &&
    clearsHardwareRule(a, b) &&
    clearsCardiganLayerRule(a, b) &&
    clearsBaseLayerRule(a, b) &&
    clearsBacklessRule(a, b)
  );
}

/**
 * Every pair the Speed Matcher still has a question about.
 *
 * Three rules decide what counts: the categories must be complementary (a top
 * never pairs with another top), the pair must clear isCompatibleCandidate
 * (belt loops, hardware finish), and the pair must not already be in
 * Item_Compatibility — without the last rule the deck never empties and the
 * same pairs come back forever.
 *
 * Pure and synchronous so the selection rule can be tested without a database;
 * the caller supplies the items and the already-rated keys.
 *
 * O(n^2) in wardrobe size, which is the size of the answer — every unrated
 * cross-category pair is one card in the deck. Sized for a personal wardrobe of
 * hundreds of items; a closet large enough for that to hurt needs the deck
 * sampled or paged rather than this made faster.
 */
export function buildUnratedPairs(
  items: readonly ClothingItem[],
  ratedKeys: ReadonlySet<string>,
): ItemPair[] {
  const pairs: ItemPair[] = [];

  for (let i = 0; i < items.length; i++) {
    const complementary = new Set(getComplementaryCategories(items[i].category));
    // Start at i + 1: each unordered pair should be offered once, not twice.
    for (let j = i + 1; j < items.length; j++) {
      if (!complementary.has(items[j].category)) continue;
      if (!isCompatibleCandidate(items[i], items[j])) continue;
      const key = pairKey(items[i].id, items[j].id);
      if (ratedKeys.has(key)) continue;
      pairs.push({ key, a: items[i], b: items[j] });
    }
  }

  return pairs;
}
