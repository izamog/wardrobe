/** @jest-environment node */
import { estimateWarmth, estimateWind } from '../warmth';
import { ALL_CATEGORIES } from '../categories';
import { ALL_MATERIALS } from '../materials';
import { SCALE_MAX } from '../format';
import type { Category } from '../../types/wardrobe';

describe('estimateWarmth / estimateWind', () => {
  it('gives every category a baseline, in range, with no materials', () => {
    for (const category of ALL_CATEGORIES) {
      expect(estimateWarmth(category, [])).toBeGreaterThanOrEqual(0);
      expect(estimateWarmth(category, [])).toBeLessThanOrEqual(SCALE_MAX);
      expect(estimateWind(category, [])).toBeGreaterThanOrEqual(0);
      expect(estimateWind(category, [])).toBeLessThanOrEqual(SCALE_MAX);
    }
  });

  it('never produces a value outside 0-SCALE_MAX for any category/material combination', () => {
    for (const category of ALL_CATEGORIES) {
      const warmth = estimateWarmth(category, [...ALL_MATERIALS]);
      const wind = estimateWind(category, [...ALL_MATERIALS]);
      expect(warmth).toBeGreaterThanOrEqual(0);
      expect(warmth).toBeLessThanOrEqual(SCALE_MAX);
      expect(wind).toBeGreaterThanOrEqual(0);
      expect(wind).toBeLessThanOrEqual(SCALE_MAX);
    }
  });

  it('rates Sandals as providing no warmth or wind resistance, unlike closed Shoes', () => {
    expect(estimateWarmth('Sandals', [])).toBe(0);
    expect(estimateWind('Sandals', [])).toBe(0);
    expect(estimateWarmth('Shoes', [])).toBeGreaterThan(estimateWarmth('Sandals', []));
  });

  it('rates a Dress slightly warmer than a plain Top, covering more of the body in one layer', () => {
    expect(estimateWarmth('Dress', [])).toBeGreaterThan(estimateWarmth('Top', []));
  });

  it('rates a Skirt less warm and less wind-resistant than a Bottom, covering less leg', () => {
    expect(estimateWarmth('Skirt', [])).toBeLessThan(estimateWarmth('Pants', []));
    expect(estimateWind('Skirt', [])).toBeLessThan(estimateWind('Pants', []));
  });

  it('rates a Coat warmer than a T-Shirt with no materials', () => {
    expect(estimateWarmth('Coat', [])).toBeGreaterThan(estimateWarmth('T-Shirt', []));
  });

  it('rates a Coat more wind-resistant than a Sweater with no materials', () => {
    expect(estimateWind('Coat', [])).toBeGreaterThan(estimateWind('Sweater', []));
  });

  it('raises warmth for an insulating material', () => {
    const plain = estimateWarmth('Sweater', []);
    const wool = estimateWarmth('Sweater', ['Wool']);
    expect(wool).toBeGreaterThan(plain);
  });

  it('lowers warmth for a cooling material', () => {
    const plain = estimateWarmth('Shirt', []);
    const linen = estimateWarmth('Shirt', ['Linen']);
    expect(linen).toBeLessThan(plain);
  });

  it('a wool cardigan is warm but not wind-resistant — the asymmetric case', () => {
    // This is the whole point of keeping two separate tables: Wool's warmth
    // adjustment is strongly positive, but its wind adjustment is 0, because a
    // knit is porous. See the module doc comment on utils/warmth.ts.
    const cardiganNoMaterial = estimateWarmth('Cardigan', []);
    const woolCardigan = estimateWarmth('Cardigan', ['Wool']);
    expect(woolCardigan).toBeGreaterThan(cardiganNoMaterial);

    const windNoMaterial = estimateWind('Cardigan', []);
    const windWithWool = estimateWind('Cardigan', ['Wool']);
    expect(windWithWool).toBe(windNoMaterial);
  });

  it('fleece is warm but actively lowers wind resistance', () => {
    const plainWind = estimateWind('Jacket', []);
    const fleeceWind = estimateWind('Jacket', ['Fleece']);
    expect(fleeceWind).toBeLessThan(plainWind);

    const plainWarmth = estimateWarmth('Jacket', []);
    const fleeceWarmth = estimateWarmth('Jacket', ['Fleece']);
    expect(fleeceWarmth).toBeGreaterThan(plainWarmth);
  });

  it('rates any closed shoe highly wind-resistant regardless of upper material', () => {
    // Unlike a garment, a closed shoe's sole and construction block wind on
    // their own — the upper's fibre barely moves the needle, unlike a
    // Bottom or Top where weave genuinely matters. Canvas and leather should
    // read as close to equally windproof.
    for (const material of ['Leather', 'Nylon', 'Denim', 'Cotton']) {
      expect(estimateWind('Shoes', [material])).toBeGreaterThanOrEqual(8);
    }
    expect(estimateWind('Shoes', [])).toBeGreaterThanOrEqual(8);
  });

  it('keeps a huge wind gap between closed Shoes and open Sandals', () => {
    expect(estimateWind('Sandals', [])).toBe(0);
    expect(estimateWind('Shoes', [])).toBeGreaterThan(estimateWind('Sandals', []) + 5);
  });

  it('a tightly-woven or coated material raises wind resistance without needing to be the warmest fibre', () => {
    const denimWind = estimateWind('Pants', ['Denim']);
    const noMaterialWind = estimateWind('Pants', []);
    expect(denimWind).toBeGreaterThan(noMaterialWind);
  });

  it('does not stack materials — only the single most significant one applies', () => {
    // If this summed, Silk (+1) and Corduroy (+1) together would exceed
    // either alone. A blend reads as its dominant fibre, not as every listed
    // fibre added together.
    const single = estimateWarmth('Shirt', ['Silk']);
    const both = estimateWarmth('Shirt', ['Silk', 'Corduroy']);
    expect(both).toBe(single);
  });

  it('picks the material with the larger adjustment as dominant, in either position', () => {
    const cashmereAlone = estimateWarmth('Sweater', ['Cashmere']);
    expect(estimateWarmth('Sweater', ['Silk', 'Cashmere'])).toBe(cashmereAlone);
    expect(estimateWarmth('Sweater', ['Cashmere', 'Silk'])).toBe(cashmereAlone);
  });

  it('a strong adjustment is not diluted by a weaker opposing one', () => {
    // Wool (+3) alongside Linen (-1): wool dominates by magnitude, so the
    // result is wool's value, not a netted-out compromise between the two.
    const woolAlone = estimateWarmth('Shirt', ['Wool']);
    expect(estimateWarmth('Shirt', ['Wool', 'Linen'])).toBe(woolAlone);
  });

  it('ignores a material with no listed adjustment', () => {
    expect(estimateWarmth('Top', ['Cotton'])).toBe(estimateWarmth('Top', []));
    expect(estimateWind('Top', ['Cotton'])).toBe(estimateWind('Top', []));
  });

  it('is unaffected by material order', () => {
    const a = estimateWarmth('Coat', ['Wool', 'Down']);
    const b = estimateWarmth('Coat', ['Down', 'Wool']);
    expect(a).toBe(b);
  });

  it('produces whole numbers only', () => {
    for (const category of ALL_CATEGORIES as Category[]) {
      expect(Number.isInteger(estimateWarmth(category, ['Wool', 'Silk']))).toBe(true);
      expect(Number.isInteger(estimateWind(category, ['Wool', 'Silk']))).toBe(true);
    }
  });
});

describe('regression: a sleeveless polyester Top must not score as warm', () => {
  it('rates a polyester Top near its baseline, not the ceiling', () => {
    // Polyester has no warmth entry at all, so this is baseline only. Reported
    // as a sleeveless vest scoring 8/10 under the old sum-based model; the
    // true answer for "Top, Polyester" has always been low.
    expect(estimateWarmth('Top', ['Polyester'])).toBe(1);
  });
});

describe('sleeve length', () => {
  it('rates a sleeveless garment colder than the same garment with long sleeves', () => {
    const sleeveless = estimateWarmth('Top', [], 'Sleeveless');
    const long = estimateWarmth('Top', [], 'Long');
    expect(sleeveless).toBeLessThan(long);
  });

  it('rates a sleeveless garment less wind-resistant than the same one with long sleeves', () => {
    const sleeveless = estimateWind('Shirt', [], 'Sleeveless');
    const long = estimateWind('Shirt', [], 'Long');
    expect(sleeveless).toBeLessThan(long);
  });

  it("'Short' is neutral — omitting sleeveLength behaves exactly like 'Short'", () => {
    expect(estimateWarmth('Sweater', ['Wool'])).toBe(estimateWarmth('Sweater', ['Wool'], 'Short'));
    expect(estimateWind('Jacket', ['Nylon'])).toBe(estimateWind('Jacket', ['Nylon'], 'Short'));
  });

  it('adds on top of the dominant material rather than competing with it', () => {
    // The sleeve axis and the material axis are independent physical facts —
    // both should move the result, not just whichever "wins". T-Shirt's low
    // baseline and Silk's mild adjustment keep this clear of the ceiling,
    // unlike a Shirt with Wool, which saturates and hides the difference.
    const base = estimateWarmth('T-Shirt', ['Silk'], 'Short');
    expect(estimateWarmth('T-Shirt', ['Silk'], 'Long')).toBeGreaterThan(base);
    expect(estimateWarmth('T-Shirt', ['Silk'], 'Sleeveless')).toBeLessThan(base);
  });
});

describe('regression: a long-sleeve linen top must score above a sleeveless equivalent', () => {
  it('a long-sleeve Top is warmer than the same Top with no sleeve information (defaults to Short)', () => {
    // Reported as a long-sleeve linen shirt scoring a flat 0/0 for both warmth
    // and windproof. Recorded under category 'Top' (the generic catch-all —
    // see its doc comment), 'Top' + Linen with no sleeve length gave exactly
    // 0/0 before this axis existed: baseline 1 - Linen's -1 = 0 for warmth,
    // and 0 - 1 clamped to 0 for wind. Long sleeves now measurably help.
    const withoutSleeveInfo = estimateWarmth('Top', ['Linen']);
    expect(withoutSleeveInfo).toBe(0);

    const longSleeve = estimateWarmth('Top', ['Linen'], 'Long');
    expect(longSleeve).toBeGreaterThan(withoutSleeveInfo);
    expect(longSleeve).toBe(1);
  });

  it('a sleeveless linen Top still scores at the floor, correctly distinguished from long sleeve', () => {
    expect(estimateWarmth('Top', ['Linen'], 'Sleeveless')).toBe(0);
    expect(estimateWarmth('Top', ['Linen'], 'Sleeveless')).toBeLessThan(
      estimateWarmth('Top', ['Linen'], 'Long'),
    );
  });
});

describe('garment length', () => {
  it('rates a full-length Bottom warmer and more wind-resistant than a short one', () => {
    const short = estimateWarmth('Pants', [], 'Short', 'Short');
    const long = estimateWarmth('Pants', [], 'Short', 'Long');
    expect(long).toBeGreaterThan(short);

    const shortWind = estimateWind('Pants', [], 'Short', 'Short');
    const longWind = estimateWind('Pants', [], 'Short', 'Long');
    expect(longWind).toBeGreaterThan(shortWind);
  });

  it('rates a maxi Skirt warmer and more wind-resistant than a mini one', () => {
    const mini = estimateWarmth('Skirt', [], 'Short', 'Mini');
    const maxi = estimateWarmth('Skirt', [], 'Short', 'Maxi');
    expect(maxi).toBeGreaterThan(mini);

    const miniWind = estimateWind('Skirt', [], 'Short', 'Mini');
    const maxiWind = estimateWind('Skirt', [], 'Short', 'Maxi');
    expect(maxiWind).toBeGreaterThan(miniWind);
  });

  it("'' (not recorded) is neutral — omitting length behaves exactly like leaving it unset", () => {
    expect(estimateWarmth('Pants', ['Wool'])).toBe(estimateWarmth('Pants', ['Wool'], 'Short', ''));
    expect(estimateWind('Skirt', ['Denim'])).toBe(estimateWind('Skirt', ['Denim'], 'Short', ''));
  });

  it('adds on top of the dominant material and sleeve length rather than competing with them', () => {
    const base = estimateWarmth('Pants', ['Silk'], 'Short', 'Cropped');
    expect(estimateWarmth('Pants', ['Silk'], 'Short', 'Long')).toBeGreaterThan(base);
    expect(estimateWarmth('Pants', ['Silk'], 'Short', 'Short')).toBeLessThan(base);
  });
});

describe('every category has a ceiling no material combination can cross', () => {
  it('holds for every category against every single material', () => {
    for (const category of ALL_CATEGORIES) {
      for (const material of ALL_MATERIALS) {
        expect(estimateWarmth(category, [material])).toBeLessThanOrEqual(
          estimateWarmth(category, [...ALL_MATERIALS]),
        );
      }
    }
  });

  it('keeps a minimal-coverage Top well below a Coat even with the warmest material', () => {
    const warmestMaterial = ALL_MATERIALS.reduce((best, m) =>
      (estimateWarmth('Top', [m]) > estimateWarmth('Top', [best]) ? m : best), ALL_MATERIALS[0]);
    expect(estimateWarmth('Top', [warmestMaterial])).toBeLessThan(estimateWarmth('Coat', []));
  });

  it('keeps Sandals at exactly 0 for warmth and wind regardless of material', () => {
    for (const material of ALL_MATERIALS) {
      expect(estimateWarmth('Sandals', [material])).toBe(0);
      expect(estimateWind('Sandals', [material])).toBe(0);
    }
  });
});
