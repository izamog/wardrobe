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

const BASE_TOPS: Category[] = ['T-Shirt', 'Top', 'Shirt'];

describe('the stated layering rules', () => {
  it('lets t-shirts, tops and shirts go under sweaters', () => {
    for (const base of BASE_TOPS) {
      expect(canLayerUnder(base, 'Sweater')).toBe(true);
    }
  });

  it('lets those three, sweaters and cardigans go under coats and jackets', () => {
    for (const inner of [...BASE_TOPS, 'Sweater', 'Cardigan'] as Category[]) {
      expect(canLayerUnder(inner, 'Coat')).toBe(true);
      expect(canLayerUnder(inner, 'Jacket')).toBe(true);
    }
  });

  it('does not let a jacket go under a coat, or a coat under a jacket', () => {
    expect(canLayerUnder('Jacket', 'Coat')).toBe(false);
    expect(canLayerUnder('Coat', 'Jacket')).toBe(false);
  });

  it('does not let a sweater go under a t-shirt, top or shirt', () => {
    for (const outer of BASE_TOPS) {
      expect(canLayerUnder('Sweater', outer)).toBe(false);
    }
  });

  it('does not let a sweater go over a jacket or coat', () => {
    expect(canLayerUnder('Jacket', 'Sweater')).toBe(false);
    expect(canLayerUnder('Coat', 'Sweater')).toBe(false);
  });

  it('lets a shirt go over a t-shirt or top', () => {
    expect(canLayerUnder('T-Shirt', 'Shirt')).toBe(true);
    expect(canLayerUnder('Top', 'Shirt')).toBe(true);
  });

  it('does not let a t-shirt or top go over a shirt', () => {
    expect(canLayerUnder('Shirt', 'T-Shirt')).toBe(false);
    expect(canLayerUnder('Shirt', 'Top')).toBe(false);
  });

  it('does not layer a t-shirt and a top in either direction', () => {
    // Not among the stated rules, so it is not permitted.
    expect(canLayerEitherWay('T-Shirt', 'Top')).toBe(false);
  });

  it('lets a cardigan go over a t-shirt or top', () => {
    expect(canLayerUnder('T-Shirt', 'Cardigan')).toBe(true);
    expect(canLayerUnder('Top', 'Cardigan')).toBe(true);
  });

  it('does not let a cardigan go over a shirt', () => {
    expect(canLayerUnder('Shirt', 'Cardigan')).toBe(false);
  });

  it('lets a cardigan go under a jacket or coat, but never over one', () => {
    expect(canLayerUnder('Cardigan', 'Jacket')).toBe(true);
    expect(canLayerUnder('Cardigan', 'Coat')).toBe(true);
    expect(canLayerUnder('Jacket', 'Cardigan')).toBe(false);
    expect(canLayerUnder('Coat', 'Cardigan')).toBe(false);
  });

  it('never puts a cardigan and a sweater together, in either order', () => {
    expect(canLayerEitherWay('Cardigan', 'Sweater')).toBe(false);
  });

  it('never layers a garment under another of its own kind', () => {
    for (const category of ALL_CATEGORIES) {
      expect(canLayerUnder(category, category)).toBe(false);
    }
  });

  it('gives every upper-body garment layering rules, including a dress', () => {
    for (const garment of [
      'T-Shirt',
      'Top',
      'Shirt',
      'Cardigan',
      'Sweater',
      'Jacket',
      'Coat',
      'Dress',
    ] as Category[]) {
      expect(isLayerableCategory(garment)).toBe(true);
    }
  });

  it('gives non-garment categories no layering permissions', () => {
    for (const other of ['Pants', 'Shoes', 'Sandals', 'Belt', 'Bag', 'Scarf'] as Category[]) {
      expect(isLayerableCategory(other)).toBe(false);
      expect(getLayersOver(other)).toEqual([]);
      expect(getLayersUnder(other)).toEqual([]);
    }
  });

  it('lets a dress go over a t-shirt or shirt, and under a cardigan, sweater, jacket or coat', () => {
    expect(canLayerUnder('T-Shirt', 'Dress')).toBe(true);
    expect(canLayerUnder('Shirt', 'Dress')).toBe(true);
    expect(canLayerUnder('Dress', 'Cardigan')).toBe(true);
    expect(canLayerUnder('Dress', 'Sweater')).toBe(true);
    expect(canLayerUnder('Dress', 'Jacket')).toBe(true);
    expect(canLayerUnder('Dress', 'Coat')).toBe(true);
  });

  it('has no relationship between a dress and a plain top, in either direction', () => {
    expect(canLayerEitherWay('Top', 'Dress')).toBe(false);
  });
});

describe('getLayersOver / getLayersUnder', () => {
  it('lists exactly what a t-shirt goes under, innermost first', () => {
    expect(getLayersOver('T-Shirt')).toEqual([
      'Shirt',
      'Cardigan',
      'Sweater',
      'Jacket',
      'Coat',
      'Dress',
    ]);
  });

  it('lists exactly what goes under a coat', () => {
    expect(getLayersUnder('Coat').sort()).toEqual([
      'Cardigan',
      'Dress',
      'Shirt',
      'Sweater',
      'T-Shirt',
      'Top',
    ]);
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
    expect(getLayersOver('T-Shirt')).toHaveLength(6);
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

  it('accepts a shirt over a top when nothing goes over the shirt', () => {
    expect(isValidLayerStack(['Top', 'Shirt'])).toBe(true);
    expect(isValidLayerStack(['Top', 'Shirt', 'Jacket'])).toBe(true);
  });

  it('accepts a cardigan over a base layer and under a coat', () => {
    expect(isValidLayerStack(['T-Shirt', 'Cardigan', 'Coat'])).toBe(true);
    expect(isValidLayerStack(['Top', 'Cardigan', 'Jacket'])).toBe(true);
  });

  it('rejects a cardigan with a shirt or a sweater', () => {
    expect(isValidLayerStack(['Shirt', 'Cardigan'])).toBe(false);
    expect(isValidLayerStack(['Cardigan', 'Sweater'])).toBe(false);
    expect(isValidLayerStack(['Sweater', 'Cardigan'])).toBe(false);
  });

  it('accepts a shirt under a sweater when the shirt is the base layer', () => {
    expect(isValidLayerStack(['Shirt', 'Sweater'])).toBe(true);
    expect(isValidLayerStack(['Shirt', 'Sweater', 'Coat'])).toBe(true);
  });

  it('rejects a shirt worn over a t-shirt or top and under a sweater', () => {
    // Every adjacent pair here is legal on its own; only the three together
    // break the rule, which is why the check is not neighbours-only.
    expect(canLayerUnder('T-Shirt', 'Shirt')).toBe(true);
    expect(canLayerUnder('Shirt', 'Sweater')).toBe(true);
    expect(isValidLayerStack(['T-Shirt', 'Shirt', 'Sweater'])).toBe(false);
    expect(isValidLayerStack(['Top', 'Shirt', 'Sweater'])).toBe(false);
    expect(isValidLayerStack(['Top', 'Shirt', 'Sweater', 'Coat'])).toBe(false);
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
    expect(isValidLayerStack(['T-Shirt', 'Pants'])).toBe(false);
    expect(isValidLayerStack(['Shoes'])).toBe(false);
    expect(isValidLayerStack(['Pants', 'Coat'])).toBe(false);
  });
});
