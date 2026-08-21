import type { Category } from '../types/wardrobe';

/**
 * Which garment may be worn directly or indirectly *under* which.
 *
 * Written as explicit [inner, outer] pairs rather than derived from a
 * hierarchy, because the rules are not a hierarchy: a Shirt sits over a
 * T-Shirt and under a Sweater, while a Sweater sits over both and under
 * neither, and a Cardigan goes over a T-Shirt but has no relationship with a
 * Sweater at all. The rules as stated:
 *
 *  - T-Shirts, Tops and Shirts all go under Sweaters.
 *  - Those three, plus Sweaters and Cardigans, all go under Jackets and Coats.
 *  - Shirts go over T-Shirts and Tops.
 *  - Cardigans go over T-Shirts and Tops, but not over Shirts.
 *  - A Dress goes over a T-Shirt or Shirt, and under a Cardigan, Sweater,
 *    Jacket or Coat — but has no relationship with a plain Top, which is what
 *    keeps utils/categories.ts's Dress-vs-Top conflict a hard exclusion
 *    rather than one this table quietly reopens.
 *
 * Everything absent from this list is disallowed, which covers the rules
 * stated as prohibitions: Jacket under Coat and the reverse, Sweater under any
 * base layer, Sweater over a Jacket or Coat, Cardigan over a Jacket or Coat,
 * Cardigan and Sweater in either order, and a Dress with a plain Top.
 *
 * The one rule that cannot be expressed here is the Shirt exception — a Shirt
 * worn over a T-Shirt or Top may not then go under a Sweater. That depends on
 * three garments at once, so it lives in isValidLayerStack().
 */
const LAYER_PAIRS: readonly (readonly [Category, Category])[] = [
  ['T-Shirt', 'Shirt'],
  ['Top', 'Shirt'],

  ['T-Shirt', 'Cardigan'],
  ['Top', 'Cardigan'],

  ['T-Shirt', 'Sweater'],
  ['Top', 'Sweater'],
  ['Shirt', 'Sweater'],

  ['T-Shirt', 'Jacket'],
  ['Top', 'Jacket'],
  ['Shirt', 'Jacket'],
  ['Cardigan', 'Jacket'],
  ['Sweater', 'Jacket'],

  ['T-Shirt', 'Coat'],
  ['Top', 'Coat'],
  ['Shirt', 'Coat'],
  ['Cardigan', 'Coat'],
  ['Sweater', 'Coat'],

  ['T-Shirt', 'Dress'],
  ['Shirt', 'Dress'],
  ['Dress', 'Cardigan'],
  ['Dress', 'Sweater'],
  ['Dress', 'Jacket'],
  ['Dress', 'Coat'],
];

/** inner -> the set of categories it may be worn under. */
const OUTER_LAYERS: ReadonlyMap<Category, ReadonlySet<Category>> = LAYER_PAIRS.reduce(
  (map, [inner, outer]) => map.set(inner, new Set(map.get(inner)).add(outer)),
  new Map<Category, ReadonlySet<Category>>(),
);

/** outer -> the set of categories that may be worn under it. */
const INNER_LAYERS: ReadonlyMap<Category, ReadonlySet<Category>> = LAYER_PAIRS.reduce(
  (map, [inner, outer]) => map.set(outer, new Set(map.get(outer)).add(inner)),
  new Map<Category, ReadonlySet<Category>>(),
);

/**
 * Every category that appears in at least one rule above.
 *
 * Derived from LAYER_PAIRS rather than listed again, so a new rule cannot make
 * the two disagree. In practice this is exactly the Top and Outerwear groups:
 * anything worn on the upper body has rules, and nothing else does.
 */
const LAYERABLE_CATEGORIES: ReadonlySet<Category> = new Set(LAYER_PAIRS.flat());

/** True when this garment has any layering rules at all. */
export function isLayerableCategory(category: Category): boolean {
  return LAYERABLE_CATEGORIES.has(category);
}

/** True when `inner` may be worn under `outer`. Directional: the reverse is a separate question. */
export function canLayerUnder(inner: Category, outer: Category): boolean {
  return OUTER_LAYERS.get(inner)?.has(outer) ?? false;
}

/** The categories `category` may be worn under, innermost rule first. */
export function getLayersOver(category: Category): Category[] {
  return [...(OUTER_LAYERS.get(category) ?? [])];
}

/** The categories that may be worn under `category`. */
export function getLayersUnder(category: Category): Category[] {
  return [...(INNER_LAYERS.get(category) ?? [])];
}

/** True when either garment may be worn under the other. */
export function canLayerEitherWay(a: Category, b: Category): boolean {
  return canLayerUnder(a, b) || canLayerUnder(b, a);
}

/**
 * True when every ordered pair in the stack is individually legal.
 *
 * Checks every ordered pair rather than only neighbours. The rules as they
 * stand happen to be transitive, so for this table the two are equivalent —
 * but nothing enforces that, and a rule added later that breaks transitivity
 * would silently start admitting illegal stacks through a neighbours-only
 * check. The all-pairs loop costs nothing at these sizes.
 */
function hasIllegalPair(stack: readonly Category[]): boolean {
  return stack.some((inner, i) => stack.slice(i + 1).some((outer) => !canLayerUnder(inner, outer)));
}

/**
 * The Shirt exception: a Shirt already covering a T-Shirt or Top is the
 * outermost that stack can wear beneath a Sweater. Every pair `hasIllegalPair`
 * checks is individually legal, so only this three-garment view catches it.
 */
function violatesShirtException(stack: readonly Category[]): boolean {
  for (let i = 0; i < stack.length; i++) {
    if (stack[i] !== 'Shirt') continue;
    const overBaseLayer = stack
      .slice(0, i)
      .some((worn) => worn === 'T-Shirt' || worn === 'Top');
    const underSweater = stack.slice(i + 1).some((worn) => worn === 'Sweater');
    if (overBaseLayer && underSweater) return true;
  }
  return false;
}

/**
 * True when an ordered stack of garments, innermost first, is wearable.
 *
 * An empty or single-garment stack is wearable. A stack containing anything
 * with no layering rules — a Bottom, a pair of Shoes — is rejected rather than
 * assumed fine: the honest answer there is "unknown", and for a generator
 * choosing what to propose, unknown must not read as yes.
 */
export function isValidLayerStack(stack: readonly Category[]): boolean {
  if (!stack.every(isLayerableCategory)) return false;
  if (hasIllegalPair(stack)) return false;
  if (violatesShirtException(stack)) return false;
  return true;
}
