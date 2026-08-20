/** @jest-environment node */
/* global describe, it, expect */
import { ALL_COLORS, canCombineColors, toColorPair, toItemColor } from '../colors';

describe('ALL_COLORS', () => {
  it('has no duplicates', () => {
    expect(new Set(ALL_COLORS).size).toBe(ALL_COLORS.length);
  });

  it('includes the three the user asked for by name', () => {
    expect(ALL_COLORS).toContain('Gold');
    expect(ALL_COLORS).toContain('Silver');
    expect(ALL_COLORS).toContain('Multi');
  });
});

describe('toItemColor', () => {
  it('accepts a colour from the vocabulary', () => {
    expect(toItemColor('Navy')).toBe('Navy');
  });

  it('rejects anything else', () => {
    for (const value of ['navy', 'Chartreuse', '', null, 7, {}]) {
      expect(toItemColor(value)).toBeNull();
    }
  });
});

describe('canCombineColors', () => {
  it('allows a second colour beside a specific one', () => {
    expect(canCombineColors('Navy')).toBe(true);
  });

  it('refuses a second colour beside Multi, which already means several', () => {
    expect(canCombineColors('Multi')).toBe(false);
  });

  it('refuses a second colour when there is no first', () => {
    expect(canCombineColors(null)).toBe(false);
  });
});

describe('toColorPair', () => {
  it('returns empties for no choice', () => {
    expect(toColorPair([])).toEqual({ primaryColor: '', secondaryColor: '' });
  });

  it('puts a single choice in the primary column', () => {
    expect(toColorPair(['Navy'])).toEqual({ primaryColor: 'Navy', secondaryColor: '' });
  });

  it('orders a pair by the vocabulary, not by the order they were tapped', () => {
    // So the same garment is not Navy/Cream one day and Cream/Navy the next.
    expect(toColorPair(['Navy', 'Cream'])).toEqual(toColorPair(['Cream', 'Navy']));
    expect(toColorPair(['Navy', 'Cream']).primaryColor).toBe('Cream');
  });

  it('lets a named colour win over Multi, which carries almost no signal', () => {
    expect(toColorPair(['Multi', 'Red'])).toEqual({ primaryColor: 'Red', secondaryColor: '' });
  });

  it('keeps Multi when it is the only choice', () => {
    expect(toColorPair(['Multi'])).toEqual({ primaryColor: 'Multi', secondaryColor: '' });
  });

  it('keeps at most two even if more are passed', () => {
    const pair = toColorPair(['Black', 'White', 'Red']);
    expect(pair.primaryColor).not.toBe('');
    expect(pair.secondaryColor).not.toBe('');
  });

  it('never produces a pair the CHECK constraints would reject', () => {
    for (const a of ALL_COLORS) {
      for (const b of ALL_COLORS) {
        const { primaryColor, secondaryColor } = toColorPair([a, b]);
        if (secondaryColor !== '') {
          expect(primaryColor).not.toBe('');
          expect(secondaryColor).not.toBe(primaryColor);
          expect(primaryColor).not.toBe('Multi');
          expect(secondaryColor).not.toBe('Multi');
        }
      }
    }
  });
});
