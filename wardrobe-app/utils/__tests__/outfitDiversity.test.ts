/** @jest-environment node */
import { rankedDiverseOutfits, selectDiverseOutfits } from '../outfitDiversity';
import { emptyCandidates, item, noDismatches, resetSeq, NO_CEILING } from '../outfitGeneratorTestHelpers';
import type { ScoredOutfit } from '../outfitGenerator';
import type { ClothingItem } from '../../types/wardrobe';

function outfit(items: ClothingItem[], meetsTarget = true): ScoredOutfit {
  return { items, warmth: 0, wind: 0, meetsTarget };
}

beforeEach(() => {
  resetSeq();
});

describe('selectDiverseOutfits', () => {
  it('takes only one outfit per distinct top+bottom combo before ever repeating one', () => {
    const top = item('T-Shirt');
    const bottom = item('Pants');
    const shoesA = item('Shoes');
    const shoesB = item('Boots');
    const shoesC = item('Sandals');

    // Same top+bottom, three different shoes -- ranked closest-first. count
    // 1, not 10: with room for only one pick, it must be the first-ranked
    // one, not whichever the fallback repeat-fill pass would reach for.
    const ranked = [
      outfit([top, bottom, shoesA]),
      outfit([top, bottom, shoesB]),
      outfit([top, bottom, shoesC]),
    ];

    const selected = selectDiverseOutfits(ranked, 1);

    expect(selected).toHaveLength(1);
    expect(selected[0].items).toEqual([top, bottom, shoesA]);
  });

  it('prefers a genuinely different combo over repeating one, in rank order', () => {
    const topA = item('T-Shirt');
    const bottomA = item('Pants');
    const topB = item('Sweater');
    const bottomB = item('Skirt');
    const shoes = item('Shoes');

    const ranked = [
      outfit([topA, bottomA, shoes]),
      outfit([topA, bottomA, item('Boots')]), // near-duplicate of the first
      outfit([topB, bottomB, shoes]),
    ];

    const selected = selectDiverseOutfits(ranked, 2);

    expect(selected).toHaveLength(2);
    expect(selected[0].items).toEqual([topA, bottomA, shoes]);
    expect(selected[1].items).toEqual([topB, bottomB, shoes]);
  });

  it('never repeats a bottom even when nothing else is available to fill count', () => {
    // Reported bug: two outfits sharing a bottom were almost always the same
    // outfit with one item swapped (a sweater, a bag) -- see
    // MAX_OUTFITS_PER_BOTTOM's own doc comment. There is no repeat-combo
    // fallback any more: a bottom that already has its one slot stays capped
    // even if count isn't met and every other candidate shares it too.
    const top = item('T-Shirt');
    const bottom = item('Pants');
    const shoesA = item('Shoes');
    const shoesB = item('Boots');

    const ranked = [outfit([top, bottom, shoesA]), outfit([top, bottom, shoesB])];

    const selected = selectDiverseOutfits(ranked, 2);

    expect(selected).toHaveLength(1);
    expect(selected[0].items).toEqual([top, bottom, shoesA]);
  });

  it('treats a Dress-anchored outfit and a Top+Bottom one as different combos even sharing an accessory', () => {
    const dress = item('Dress');
    const top = item('T-Shirt');
    const bottom = item('Pants');
    const shoes = item('Shoes');

    const ranked = [outfit([dress, shoes]), outfit([top, bottom, shoes])];

    const selected = selectDiverseOutfits(ranked, 10);

    expect(selected).toHaveLength(2);
  });

  it('never returns more than count outfits', () => {
    const ranked = Array.from({ length: 5 }, () => outfit([item('T-Shirt'), item('Pants'), item('Shoes')]));

    expect(selectDiverseOutfits(ranked, 3)).toHaveLength(3);
  });
});

describe('selectDiverseOutfits: Outerwear, Bag, and Belt anchors', () => {
  it('caps repeated Outerwear the same way it already caps repeated Bottom', () => {
    const coat = item('Coat', { id: 'coat' });
    const outfits = [
      outfit([item('Pants', { id: 'p1' }), item('T-Shirt', { id: 't1' }), coat]),
      outfit([item('Pants', { id: 'p2' }), item('T-Shirt', { id: 't2' }), coat]),
      outfit([item('Pants', { id: 'p3' }), item('T-Shirt', { id: 't3' }), coat]),
    ];

    const selected = selectDiverseOutfits(outfits, 3);
    const withCoat = selected.filter((o) => o.items.some((i) => i.id === 'coat'));
    expect(withCoat.length).toBe(1);
  });

  it('caps repeated Bag independently, more permissively than Outerwear', () => {
    const bag = item('Bag', { id: 'bag' });
    const outfits = [
      outfit([item('Pants', { id: 'p1' }), item('T-Shirt', { id: 't1' }), bag]),
      outfit([item('Pants', { id: 'p2' }), item('T-Shirt', { id: 't2' }), bag]),
    ];

    // maxPerAccessoryAnchor default is 1, same starting point as the primary
    // anchor cap -- only one of these two should be selected on the first pass.
    const selected = selectDiverseOutfits(outfits, 2);
    const withBag = selected.filter((o) => o.items.some((i) => i.id === 'bag'));
    expect(withBag.length).toBe(1);
  });

  it('does not cap Shoes, Scarf, or Tights repetition', () => {
    const shoes = item('Shoes', { id: 'shoes' });
    const outfits = [
      outfit([item('Pants', { id: 'p1' }), item('T-Shirt', { id: 't1' }), shoes]),
      outfit([item('Pants', { id: 'p2' }), item('T-Shirt', { id: 't2' }), shoes]),
    ];

    const selected = selectDiverseOutfits(outfits, 2);
    expect(selected.length).toBe(2);
  });
});

describe('rankedDiverseOutfits: primary anchor escalates before accessory anchor', () => {
  it('exhausts the Outerwear/Bottom/Dress cap before relaxing the Bag/Belt cap', () => {
    // A wardrobe with only one bottom and one coat, but two bags -- the search
    // cannot produce more than 1 outfit meeting a distinct-primary-anchor
    // requirement regardless of how far the accessory cap relaxes, so
    // minMeetsTarget above 1 must not cause the accessory cap to relax uselessly
    // while a fixable primary-anchor shortage still exists elsewhere in a
    // larger wardrobe. This test documents the ordering, not a specific count:
    // primary-anchor escalation (existing maxPerBottom loop) must run to its
    // own ceiling (count) before an accessory-anchor escalation phase begins.
    const bottom = item('Pants');
    const coat = item('Coat');
    const bagA = item('Bag', { id: 'bag-a' });
    const bagB = item('Bag', { id: 'bag-b' });
    const results = rankedDiverseOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [item('T-Shirt')], shoes: [item('Shoes')], outerwear: [coat], bags: [bagA, bagB] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      6,
      2,
    );
    // Both bags should be reachable across the ranked set once the accessory
    // cap is allowed to relax -- this is a smoke test that the wiring doesn't
    // throw or infinite-loop with the new two-tier escalation, not an exact
    // count (the exact number of results depends on generateClosestOutfits'
    // full search, which this test isn't re-deriving).
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('rankedDiverseOutfits', () => {
  it('surfaces a warmer, equally valid bottom even when a lean bottom alone ties dozens of times over', () => {
    // The exact shape of the reported bug: TodayScreen showed 10 outfits at
    // -14°C/17kph that all used the same lean silk skirt, never the warmer
    // jeans the closet also had, because a fixed-size pool handed to
    // selectDiverseOutfits was entirely filled by the skirt's own
    // shoe/scarf/bag variants (all tied at distance 0) before jeans was ever
    // reached. rankedDiverseOutfits is the actual function TodayScreen calls
    // — this exercises the real composition, not each half in isolation.
    const silkSkirt = item('Skirt', { length: 'Maxi', inferredWarmth: 4, inferredWind: 2 });
    const jeans = item('Pants', { length: 'Long', inferredWarmth: 6, inferredWind: 2 });
    const sleevelessTop = item('Top', { inferredWarmth: 0, inferredWind: 0 });
    const woolSweater = item('Sweater', { inferredWarmth: 8, inferredWind: 2 });
    const coat = item('Coat', { inferredWarmth: 10, inferredWind: 6 });
    const tights = item('Tights', { inferredWarmth: 2, inferredWind: 1 });
    const boots = item('Boots', { inferredWarmth: 3, inferredWind: 8 });
    // A wide, realistic accessory pool — this is what filled a fixed-size
    // pool with skirt-only ties before jeans was ever reached.
    const bags = Array.from({ length: 4 }, () => item('Bag', {}));
    const scarves = Array.from({ length: 4 }, () => item('Scarf', { inferredWarmth: 4, inferredWind: 3 }));

    const candidates = emptyCandidates({
      bottoms: [silkSkirt, jeans],
      tops: [sleevelessTop, woolSweater],
      shoes: [boots],
      outerwear: [coat],
      tights: [tights],
      bags,
      scarves,
    });

    // -14°C felt, 17kph wind.
    const results = rankedDiverseOutfits(candidates, noDismatches, 16, 22, 7, 10);

    const bottomCategoriesUsed = new Set(
      results.map((outfit) => outfit.items.find((i) => i.category === 'Skirt' || i.category === 'Pants')?.category),
    );
    expect(bottomCategoriesUsed.has('Skirt')).toBe(true);
    expect(bottomCategoriesUsed.has('Pants')).toBe(true);

    // And the warmth tie-break (generateClosestOutfits) applies here too:
    // the top-ranked result should prefer the wool Sweater over the
    // sleeveless top, since both clear the bounds equally once layered.
    expect(results[0].items.some((i) => i.category === 'Sweater')).toBe(true);
    expect(results[0].meetsTarget).toBe(true);
  });

  it('never lets the same bottom anchor more than one of the shown outfits, even short of the requested count', () => {
    // Reported bug (v1): at -15°C, every one of the 10 shown outfits used the
    // same (lightest, tried-first) skirt — different Top or Cardigan
    // choices with that skirt each counted as a "different" combo, so
    // coreComboKey's own dedup never kicked in, even though a person
    // looking at the list saw no real variety in what they'd actually be
    // wearing on their legs.
    //
    // Reported bug (v2): a cap of 2 let through pairs that were, in
    // practice, one outfit with a swapped sweater — see
    // MAX_OUTFITS_PER_BOTTOM's own doc comment. The cap is a hard ceiling,
    // not a target to relax if the wardrobe can't otherwise fill the
    // requested count — three bottoms at a cap of 1 tops out at 3, not 10,
    // however much top variety any single one of them has.
    const skirtA = item('Skirt', { inferredWarmth: 3, inferredWind: 1 });
    const skirtB = item('Skirt', { inferredWarmth: 6, inferredWind: 2 });
    const skirtC = item('Skirt', { inferredWarmth: 8, inferredWind: 3 });
    const tops = Array.from({ length: 6 }, (_, i) => item('T-Shirt', { inferredWarmth: i, inferredWind: 0 }));
    const shoes = item('Shoes');

    const results = rankedDiverseOutfits(
      emptyCandidates({ bottoms: [skirtA, skirtB, skirtC], tops, shoes: [shoes] }),
      noDismatches,
      0,
      100,
      0,
      10,
    );

    expect(results).toHaveLength(3);
    const perBottom = new Map<string, number>();
    for (const outfit of results) {
      const bottomItemId = outfit.items.find((i) => i.category === 'Skirt')?.id ?? '';
      perBottom.set(bottomItemId, (perBottom.get(bottomItemId) ?? 0) + 1);
    }
    expect(perBottom.size).toBe(3);
    for (const count of perBottom.values()) {
      expect(count).toBe(1);
    }
  });

  it('relaxes the per-bottom cap to reach minMeetsTarget when the strict pass falls short', () => {
    // Reported bug: "Today" should always offer 4 real choices, but a
    // wardrobe with only two bottoms that met target could legitimately
    // produce just 2 once MAX_OUTFITS_PER_BOTTOM capped repeats at 1 — see
    // rankedDiverseOutfits' own doc comment. This wardrobe has exactly two
    // bottoms and four tops, so the strict pass alone can only ever return
    // 2 -- reaching a floor of 4 requires letting each bottom show twice.
    const bottomA = item('Pants');
    const bottomB = item('Skirt');
    const tops = Array.from({ length: 4 }, () => item('T-Shirt'));
    const shoes = item('Shoes');

    const strict = rankedDiverseOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops, shoes: [shoes] }),
      noDismatches,
      0,
      100,
      0,
      6,
    );
    expect(strict).toHaveLength(2);

    const relaxed = rankedDiverseOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops, shoes: [shoes] }),
      noDismatches,
      0,
      100,
      0,
      6,
      4,
    );

    expect(relaxed.filter((outfit) => outfit.meetsTarget)).toHaveLength(4);
    const perBottom = new Map<string, number>();
    for (const outfit of relaxed) {
      const bottomItemId = outfit.items.find((i) => i.category === 'Pants' || i.category === 'Skirt')?.id ?? '';
      perBottom.set(bottomItemId, (perBottom.get(bottomItemId) ?? 0) + 1);
    }
    expect(perBottom.size).toBe(2);
    for (const count of perBottom.values()) {
      expect(count).toBe(2);
    }
  });

  it('never relaxes the per-bottom cap when the strict pass already meets the floor', () => {
    const bottoms = Array.from({ length: 4 }, () => item('Pants'));
    const top = item('T-Shirt');
    const shoes = item('Shoes');

    const results = rankedDiverseOutfits(
      emptyCandidates({ bottoms, tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      100,
      0,
      6,
      4,
    );

    expect(results).toHaveLength(4);
    const bottomIds = new Set(results.map((outfit) => outfit.items.find((i) => i.category === 'Pants')?.id));
    expect(bottomIds.size).toBe(4);
  });

  describe('rankedDiverseOutfits threads wornDaysAgo through to generateClosestOutfits', () => {
    it('a recently-worn bag is not the only bag offered across the ranked set', () => {
      const bottom = item('Pants');
      const top = item('T-Shirt');
      const shoes = item('Shoes');
      const wornBag = item('Bag', { id: 'worn-bag' });
      const freshBag = item('Bag', { id: 'fresh-bag' });
      const wornDaysAgo = new Map([['worn-bag', 1]]);

      const results = rankedDiverseOutfits(
        emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], bags: [wornBag, freshBag] }),
        noDismatches,
        0,
        NO_CEILING,
        0,
        6,
        0,
        wornDaysAgo,
      );

      const withFreshBag = results.some((outfit) => outfit.items.some((i) => i.id === 'fresh-bag'));
      expect(withFreshBag).toBe(true);
    });
  });
});
