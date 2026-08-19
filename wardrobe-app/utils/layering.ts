import type { Category } from '../types/wardrobe';

/**
 * Which garment may be worn directly or indirectly *under* which.
 *
 * Written as explicit [inner, outer] pairs rather than derived from a
 * hierarchy, because the rules are not a hierarchy: a Shirt sits over a
 * T-Shirt and under a Sweater, while a Sweater sits over both and under
 * neither. The transcription of the stated rules is:
 *
 *  - T-Shirts, Shirts and Tanks all go under Sweaters.
 *  - Those three and Sweaters all go under Jackets and Coats.
 *  - Shirts go over T-Shirts and Tanks.
 *
 * Everything absent from this list is disallowed, which covers the rules
 * stated as prohibitions: Jacket under Coat and Coat under Jacket, Sweater
 * under any of T-Shirt/Shirt/Tank, and Sweater over a Jacket or Coat.
 *
 * The one rule that cannot be expressed here is the Shirt exception — a Shirt
 * worn over a T-Shirt or Tank may not then go under a Sweater. That depends on
 * three garments at once, so it lives in isValidLayerStack().
 */
const LAYER_PAIRS: readonly (readonly [Category, Category])[] = [
  ['T-Shirt', 'Shirt'],
  ['Tank', 'Shirt'],

  ['T-Shirt', 'Sweater'],
  ['Shirt', 'Sweater'],
  ['Tank', 'Sweater'],

  ['T-Shirt', 'Jacket'],
  ['Shirt', 'Jacket'],
  ['Tank', 'Jacket'],
  ['Sweater', 'Jacket'],

  ['T-Shirt', 'Coat'],
  ['Shirt', 'Coat'],
  ['Tank', 'Coat'],
  ['Sweater', 'Coat'],
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
 * the two disagree. Note what this excludes: the generic 'Top' and 'Outerwear'
 * carry no rules, so nothing can be concluded about layering them, and
 * isValidLayerStack() treats a stack containing one as unanswerable.
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
 * True when an ordered stack of garments, innermost first, is wearable.
 *
 * Checks every ordered pair rather than only neighbours. The rules as they
 * stand happen to be transitive, so for this table the two are equivalent —
 * but nothing enforces that, and a rule added later that breaks transitivity
 * would silently start admitting illegal stacks through a neighbours-only
 * check. The all-pairs loop costs nothing at these sizes.
 *
 * An empty or single-garment stack is wearable. A stack containing anything
 * with no layering rules — a Bottom, or a legacy generic 'Top' — is rejected
 * rather than assumed fine: the honest answer there is "unknown", and for a
 * generator choosing what to propose, unknown must not read as yes.
 */
export function isValidLayerStack(stack: readonly Category[]): boolean {
  if (!stack.every(isLayerableCategory)) return false;

  for (let inner = 0; inner < stack.length; inner++) {
    for (let outer = inner + 1; outer < stack.length; outer++) {
      if (!canLayerUnder(stack[inner], stack[outer])) return false;
    }
  }

  // The Shirt exception: a Shirt already covering a T-Shirt or Tank is the
  // outermost that stack can wear beneath a Sweater. Every pair above is
  // individually legal, so only this three-garment view rejects it.
  for (let i = 0; i < stack.length; i++) {
    if (stack[i] !== 'Shirt') continue;
    const overBaseLayer = stack
      .slice(0, i)
      .some((worn) => worn === 'T-Shirt' || worn === 'Tank');
    const underSweater = stack.slice(i + 1).some((worn) => worn === 'Sweater');
    if (overBaseLayer && underSweater) return false;
  }

  return true;
}
