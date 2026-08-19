/** @jest-environment node */
import {
  canLayerEitherWay,
  canLayerUnder,
  getLayersOver,
  getLayersUnder,
  isLayerableCategory,
  isValidLayerStack,
} from '../layering';
import { ALL_CATEGORIES } from '../categories';
import type { Category } from '../../types/wardrobe';

const BASE_TOPS: Category[] = ['T-Shirt', 'Shirt', 'Tank'];

describe('the stated layering rules', () => {
  it('lets t-shirts, shirts and tanks go under sweaters', () => {
    for (const base of BASE_TOPS) {
      expect(canLayerUnder(base, 'Sweater')).toBe(true);
    }
  });

  it('lets those three and sweaters go under coats and jackets', () => {
    for (const inner of [...BASE_TOPS, 'Sweater'] as Category[]) {
      expect(canLayerUnder(inner, 'Coat')).toBe(true);
      expect(canLayerUnder(inner, 'Jacket')).toBe(true);
    }
  });

  it('does not let a jacket go under a coat, or a coat under a jacket', () => {
    expect(canLayerUnder('Jacket', 'Coat')).toBe(false);
    expect(canLayerUnder('Coat', 'Jacket')).toBe(false);
  });

  it('does not let a sweater go under a t-shirt, shirt or tank', () => {
    for (const outer of BASE_TOPS) {
      expect(canLayerUnder('Sweater', outer)).toBe(false);
    }
  });

  it('does not let a sweater go over a jacket or coat', () => {
    expect(canLayerUnder('Jacket', 'Sweater')).toBe(false);
    expect(canLayerUnder('Coat', 'Sweater')).toBe(false);
  });

  it('lets a shirt go over a t-shirt or tank', () => {
    expect(canLayerUnder('T-Shirt', 'Shirt')).toBe(true);
    expect(canLayerUnder('Tank', 'Shirt')).toBe(true);
  });

  it('does not let a t-shirt or tank go over a shirt', () => {
    expect(canLayerUnder('Shirt', 'T-Shirt')).toBe(false);
    expect(canLayerUnder('Shirt', 'Tank')).toBe(false);
  });

  it('does not layer a t-shirt and a tank in either direction', () => {
    // Not among the stated rules, so it is not permitted.
    expect(canLayerEitherWay('T-Shirt', 'Tank')).toBe(false);
  });

  it('never layers a garment under another of its own kind', () => {
    for (const category of ALL_CATEGORIES) {
      expect(canLayerUnder(category, category)).toBe(false);
    }
  });

  it('gives the legacy generic categories no layering permissions', () => {
    for (const generic of ['Top', 'Outerwear'] as Category[]) {
      expect(isLayerableCategory(generic)).toBe(false);
      expect(getLayersOver(generic)).toEqual([]);
      expect(getLayersUnder(generic)).toEqual([]);
    }
  });

  it('gives non-garment categories no layering permissions', () => {
    for (const other of ['Bottom', 'Shoes', 'Belt', 'Bag', 'Scarf'] as Category[]) {
      expect(isLayerableCategory(other)).toBe(false);
    }
  });
});

describe('getLayersOver / getLayersUnder', () => {
  it('lists exactly what a t-shirt goes under, innermost first', () => {
    // Order is the rule-declaration order and is what the UI renders.
    expect(getLayersOver('T-Shirt')).toEqual(['Shirt', 'Sweater', 'Jacket', 'Coat']);
  });

  it('lists exactly what goes under a coat', () => {
    expect(getLayersUnder('Coat').sort()).toEqual(['Shirt', 'Sweater', 'T-Shirt', 'Tank']);
  });

  it('agrees with canLayerUnder in both directions', () => {
    for (const inner of ALL_CATEGORIES) {
      for (const outer of ALL_CATEGORIES) {
        expect(getLayersOver(inner).includes(outer)).toBe(canLayerUnder(inner, outer));
        expect(getLayersUnder(outer).includes(inner)).toBe(canLayerUnder(inner, outer));
      }
    }
  });

  it('returns a fresh array so callers cannot mutate the rule table', () => {
    getLayersOver('T-Shirt').pop();
    expect(getLayersOver('T-Shirt')).toHaveLength(4);
  });
});

describe('isValidLayerStack', () => {
  it('accepts an empty stack and a single garment', () => {
    expect(isValidLayerStack([])).toBe(true);
    expect(isValidLayerStack(['Sweater'])).toBe(true);
  });

  it('accepts a t-shirt under a sweater under a coat', () => {
    expect(isValidLayerStack(['T-Shirt', 'Sweater', 'Coat'])).toBe(true);
  });

  it('accepts a shirt over a tank when nothing goes over the shirt', () => {
    expect(isValidLayerStack(['Tank', 'Shirt'])).toBe(true);
    expect(isValidLayerStack(['Tank', 'Shirt', 'Jacket'])).toBe(true);
  });

  it('accepts a shirt under a sweater when the shirt is the base layer', () => {
    expect(isValidLayerStack(['Shirt', 'Sweater'])).toBe(true);
    expect(isValidLayerStack(['Shirt', 'Sweater', 'Coat'])).toBe(true);
  });

  it('rejects a shirt worn over a t-shirt or tank and under a sweater', () => {
    // Every adjacent pair here is legal on its own; only the three together
    // break the rule, which is why the check is not neighbours-only.
    expect(canLayerUnder('T-Shirt', 'Shirt')).toBe(true);
    expect(canLayerUnder('Shirt', 'Sweater')).toBe(true);
    expect(isValidLayerStack(['T-Shirt', 'Shirt', 'Sweater'])).toBe(false);
    expect(isValidLayerStack(['Tank', 'Shirt', 'Sweater'])).toBe(false);
    expect(isValidLayerStack(['Tank', 'Shirt', 'Sweater', 'Coat'])).toBe(false);
  });

  it('rejects a jacket and a coat in the same stack', () => {
    expect(isValidLayerStack(['Jacket', 'Coat'])).toBe(false);
    expect(isValidLayerStack(['Coat', 'Jacket'])).toBe(false);
    // Still rejected with a legal garment underneath both.
    expect(isValidLayerStack(['Sweater', 'Jacket', 'Coat'])).toBe(false);
  });

  it('rejects a stack in the wrong order', () => {
    expect(isValidLayerStack(['Sweater', 'T-Shirt'])).toBe(false);
    expect(isValidLayerStack(['Coat', 'Sweater'])).toBe(false);
  });

  it('rejects repeating the same garment', () => {
    expect(isValidLayerStack(['T-Shirt', 'T-Shirt'])).toBe(false);
  });

  it('rejects anything with no layering rules rather than assuming it is fine', () => {
    expect(isValidLayerStack(['T-Shirt', 'Bottom'])).toBe(false);
    expect(isValidLayerStack(['Top'])).toBe(false);
    expect(isValidLayerStack(['Top', 'Coat'])).toBe(false);
  });
});
