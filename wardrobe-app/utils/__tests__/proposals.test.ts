/**
 * @jest-environment node
 *
 * parseExtraction is the boundary between a language model and the database.
 * These tests are mostly hostile input, because that is what the boundary is
 * for: structured output guarantees the shape of a reply and nothing at all
 * about the values inside it.
 */
import { parseExtraction } from '../proposals';
import { SCALE_MAX } from '../format';

describe('parseExtraction: malformed input', () => {
  it('yields an empty proposal rather than throwing', () => {
    for (const garbage of [null, undefined, 42, 'text', [], { unrelated: true }]) {
      expect(parseExtraction(garbage)).toEqual({});
    }
  });

  it('keeps the fields it can read and drops the ones it cannot', () => {
    expect(parseExtraction({ brand: 'Arket', costInPounds: 'forty' })).toEqual({ brand: 'Arket' });
  });
});

describe('parseExtraction: brand', () => {
  it('trims a usable brand', () => {
    expect(parseExtraction({ brand: '  Arket ' }).brand).toBe('Arket');
  });

  it('treats the column default as nothing heard, so it does not become a card', () => {
    expect(parseExtraction({ brand: 'Unknown' }).brand).toBeUndefined();
    expect(parseExtraction({ brand: 'unknown' }).brand).toBeUndefined();
  });

  it('drops an empty or whitespace-only brand', () => {
    expect(parseExtraction({ brand: '' }).brand).toBeUndefined();
    expect(parseExtraction({ brand: '   ' }).brand).toBeUndefined();
  });

  it('drops a brand long enough to be narration rather than an answer', () => {
    expect(parseExtraction({ brand: 'A'.repeat(61) }).brand).toBeUndefined();
    expect(parseExtraction({ brand: 'A'.repeat(60) }).brand).toBe('A'.repeat(60));
  });

  it('drops a non-string brand', () => {
    expect(parseExtraction({ brand: { name: 'Arket' } }).brand).toBeUndefined();
  });
});

describe('parseExtraction: cost', () => {
  it('converts pounds to whole minor units', () => {
    expect(parseExtraction({ costInPounds: 40 }).costMinorUnits).toBe(4000);
    expect(parseExtraction({ costInPounds: 24.99 }).costMinorUnits).toBe(2499);
  });

  it('accepts free', () => {
    expect(parseExtraction({ costInPounds: 0 }).costMinorUnits).toBe(0);
  });

  it('rounds sub-penny amounts rather than storing a fraction', () => {
    // costMinorUnits is INTEGER; a fractional value would fail the insert.
    expect(Number.isInteger(parseExtraction({ costInPounds: 10.005 }).costMinorUnits)).toBe(true);
  });

  it('drops a negative price', () => {
    expect(parseExtraction({ costInPounds: -5 }).costMinorUnits).toBeUndefined();
  });

  it('drops an implausible price, which is a misheard year or size', () => {
    expect(parseExtraction({ costInPounds: 100_001 }).costMinorUnits).toBeUndefined();
  });

  it('drops non-finite and non-numeric values', () => {
    expect(parseExtraction({ costInPounds: Number.NaN }).costMinorUnits).toBeUndefined();
    expect(parseExtraction({ costInPounds: Number.POSITIVE_INFINITY }).costMinorUnits).toBeUndefined();
    expect(parseExtraction({ costInPounds: '40' }).costMinorUnits).toBeUndefined();
  });
});

describe('parseExtraction: colours', () => {
  it('reads one colour', () => {
    expect(parseExtraction({ colors: ['Navy'] })).toEqual({ primaryColor: 'Navy' });
  });

  it('accepts the casing a model actually returns', () => {
    expect(parseExtraction({ colors: ['navy', ' CREAM '] })).toEqual({
      primaryColor: 'Cream',
      secondaryColor: 'Navy',
    });
  });

  it('orders the pair by the vocabulary, not by how they were said', () => {
    // So the same garment is never Navy/Cream one day and Cream/Navy the next.
    expect(parseExtraction({ colors: ['Navy', 'Cream'] })).toEqual(
      parseExtraction({ colors: ['Cream', 'Navy'] }),
    );
  });

  it('keeps only the first two colours', () => {
    const result = parseExtraction({ colors: ['Black', 'White', 'Red', 'Blue'] });
    expect(Object.keys(result).sort()).toEqual(['primaryColor', 'secondaryColor']);
  });

  it('drops a duplicate, which the CHECK constraint would reject', () => {
    expect(parseExtraction({ colors: ['Navy', 'Navy'] })).toEqual({ primaryColor: 'Navy' });
  });

  it('reads Multi on its own', () => {
    expect(parseExtraction({ colors: ['Multi'] })).toEqual({ primaryColor: 'Multi' });
  });

  it('prefers a specific colour over Multi when both are offered', () => {
    // Multi carries almost no signal for matching; Red carries a lot. It also
    // keeps Multi out of the secondary column, which the schema forbids.
    expect(parseExtraction({ colors: ['Multi', 'Red'] })).toEqual({ primaryColor: 'Red' });
    expect(parseExtraction({ colors: ['Multi', 'Red', 'Blue'] })).toEqual({
      primaryColor: 'Red',
      secondaryColor: 'Blue',
    });
  });

  it('drops colours outside the vocabulary', () => {
    expect(parseExtraction({ colors: ['Chartreuse'] })).toEqual({});
    expect(parseExtraction({ colors: ['Chartreuse', 'Red'] })).toEqual({ primaryColor: 'Red' });
  });

  it('ignores a non-array', () => {
    expect(parseExtraction({ colors: 'Navy' })).toEqual({});
  });
});

describe('parseExtraction: category, materials and hardware', () => {
  it('reads a category from the vocabulary, ignoring case', () => {
    expect(parseExtraction({ category: 'sweater' }).category).toBe('Sweater');
  });

  it('drops a category that no longer exists', () => {
    // 'Tank' was retired in migration v4.
    expect(parseExtraction({ category: 'Tank' }).category).toBeUndefined();
    expect(parseExtraction({ category: 'Onesie' }).category).toBeUndefined();
  });

  it('keeps known materials in vocabulary order and drops the rest', () => {
    expect(parseExtraction({ materials: ['elastane', 'wool', 'unobtainium'] }).materials).toEqual([
      'Elastane',
      'Wool',
    ]);
  });

  it('treats an all-unknown material list as nothing heard', () => {
    expect(parseExtraction({ materials: ['unobtainium'] }).materials).toBeUndefined();
  });

  it('reads hardware colour only from its own smaller vocabulary', () => {
    expect(parseExtraction({ hardwareColor: 'gold' }).hardwareColor).toBe('Gold');
    // Brass is a garment colour candidate but not a hardware finish we store.
    expect(parseExtraction({ hardwareColor: 'Brass' }).hardwareColor).toBeUndefined();
  });
});

describe('parseExtraction: booleans and estimates', () => {
  it('reads booleans only when they are actually booleans', () => {
    expect(parseExtraction({ isSecondHand: true }).isSecondHand).toBe(true);
    expect(parseExtraction({ isSecondHand: false }).isSecondHand).toBe(false);
    expect(parseExtraction({ isSecondHand: 'yes' }).isSecondHand).toBeUndefined();
    expect(parseExtraction({ hasBeltLoops: 1 }).hasBeltLoops).toBeUndefined();
  });

  it('clamps an over-range estimate instead of discarding the signal', () => {
    // Unlike brand and cost, these are estimates on an arbitrary scale: a 12
    // for a heavy parka still says something true.
    expect(parseExtraction({ inferredWarmth: 12 }).inferredWarmth).toBe(SCALE_MAX);
    expect(parseExtraction({ inferredWind: -3 }).inferredWind).toBe(0);
  });

  it('rounds a fractional estimate, since the column is an integer', () => {
    expect(parseExtraction({ inferredWarmth: 6.6 }).inferredWarmth).toBe(7);
  });

  it('drops a non-numeric estimate', () => {
    expect(parseExtraction({ inferredWarmth: 'warm' }).inferredWarmth).toBeUndefined();
    expect(parseExtraction({ inferredWind: Number.NaN }).inferredWind).toBeUndefined();
  });
});

describe('parseExtraction: a realistic reply', () => {
  it('reads everything a good answer contains', () => {
    expect(
      parseExtraction({
        brand: 'Arket',
        costInPounds: 40,
        colors: ['navy'],
        category: 'Sweater',
        isSecondHand: true,
        materials: ['Wool'],
        hardwareColor: 'None',
        hasBeltLoops: false,
        inferredWarmth: 7,
        inferredWind: 3,
      }),
    ).toEqual({
      brand: 'Arket',
      costMinorUnits: 4000,
      primaryColor: 'Navy',
      category: 'Sweater',
      isSecondHand: true,
      materials: ['Wool'],
      hardwareColor: 'None',
      hasBeltLoops: false,
      inferredWarmth: 7,
      inferredWind: 3,
    });
  });
});
