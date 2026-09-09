/** @jest-environment node */
import { generateClosestOutfits, generateOutfits, sumWarmth } from '../outfitGenerator';
import { emptyCandidates, item, NO_CEILING, noDismatches, resetSeq } from '../outfitGeneratorTestHelpers';
import { warmthCeiling, warmthFloor, windFloor } from '../thermal';
import { estimateWarmth, estimateWind } from '../warmth';
import { floorAwareCandidates, shoeCandidatesFor } from '../outfitCandidatePools';

beforeEach(() => {
  resetSeq();
});

describe('generateOutfits: regression — a warm coat cannot mask a bare torso or bare legs at 6°C', () => {
  // Reproduces the reported bug directly: a mini skirt and a sleeveless top,
  // both scoring at or near 0 on their own, summed to a warm-enough outfit
  // total purely on the strength of a heavy wool coat -- "top w0, coat w10"
  // clearing the floor even though neither the legs nor the torso were
  // actually dressed for 6°C. Both region floors (see
  // REGION_WARMTH_FLOOR_FRACTION) now have to be cleared independently of
  // whatever the outerwear layer contributes.
  const feltTempC = 6;
  const windSpeedKph = 0;
  const floor = warmthFloor(feltTempC);
  const ceiling = warmthCeiling(feltTempC);
  const wFloor = windFloor(windSpeedKph, feltTempC);

  const miniSkirt = item('Skirt', {
    inferredWarmth: estimateWarmth('Skirt', [], 'Short', 'Mini'),
    inferredWind: estimateWind('Skirt', [], 'Short', 'Mini'),
  });
  const sleevelessTop = item('T-Shirt', {
    sleeveLength: 'Sleeveless',
    inferredWarmth: estimateWarmth('T-Shirt', [], 'Sleeveless'),
    inferredWind: estimateWind('T-Shirt', [], 'Sleeveless'),
  });
  const shoes = item('Shoes', {
    inferredWarmth: estimateWarmth('Shoes', []),
    inferredWind: estimateWind('Shoes', []),
  });
  // Plain (no-material), not wool-and-Long: with the region floors below
  // already demanding a genuinely warm top and bottom, a wool Coat's own
  // clamped-to-max warmth on top of those busts the ceiling before ever
  // reaching the actual point of this test.
  const woolCoat = item('Coat', {
    inferredWarmth: estimateWarmth('Coat', []),
    inferredWind: estimateWind('Coat', []),
  });

  it('finds no outfit from a bare mini skirt and sleeveless top alone, however warm the coat is', () => {
    const results = generateOutfits(
      emptyCandidates({ bottoms: [miniSkirt], tops: [sleevelessTop], shoes: [shoes], outerwear: [woolCoat] }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(results).toEqual([]);
  });

  it('finds a valid outfit once trousers and a jumper are also available', () => {
    // Wool, not Denim: the higher floor at 6°C (WARMTH_UNITS_PER_DEGREE)
    // raises the leg-region target above what Denim's own clamped warmth can
    // reach on its own.
    const trousers = item('Pants', {
      inferredWarmth: estimateWarmth('Pants', ['Wool'], 'Short', 'Long'),
      inferredWind: estimateWind('Pants', ['Wool'], 'Short', 'Long'),
    });
    // Wool, not plain: same reasoning, for the torso-region target.
    const woolJumper = item('Sweater', {
      inferredWarmth: estimateWarmth('Sweater', ['Wool']),
      inferredWind: estimateWind('Sweater', ['Wool']),
    });

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [miniSkirt, trousers],
        tops: [sleevelessTop, woolJumper],
        shoes: [shoes],
        outerwear: [woolCoat],
      }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
    );

    expect(results.length).toBeGreaterThan(0);
    for (const outfit of results) {
      expect(outfit.some((i) => i.id === miniSkirt.id)).toBe(false);
      expect(outfit.some((i) => i.id === sleevelessTop.id)).toBe(false);
    }
  });
});

describe('generateClosestOutfits: regression — the cold-weather ceiling has room for a coat over a full layering system at 5°C', () => {
  // Reported bug: jeans + wool sweater + long-sleeve T-shirt base layer +
  // leather boots + wool coat (24 summed, weighted warmth) sat 1 point above
  // a flat floor+5 ceiling of 23 at 5°C -- the exact outfit a coat was meant
  // to complete, given that jeans + sweater + T-shirt + boots alone (14)
  // falls short of the 18 floor, was itself rejected as overdressed. Both
  // this outfit and the same one with the T-shirt base layer dropped (22)
  // must be accepted -- see COLD_CEILING_BONUS_MAX in thermal.ts.
  it('accepts the reported outfit with and without its T-shirt base layer', () => {
    const feltTempC = 5;
    const windSpeedKph = 0;
    const floor = warmthFloor(feltTempC);
    const ceiling = warmthCeiling(feltTempC);
    const wFloor = windFloor(windSpeedKph, feltTempC);
    expect(floor).toBe(18);
    expect(ceiling).toBe(25);

    const jeans = item('Pants', {
      inferredWarmth: estimateWarmth('Pants', ['Denim'], 'Short', 'Long'),
      inferredWind: estimateWind('Pants', ['Denim'], 'Short', 'Long'),
    });
    const woolSweater = item('Sweater', {
      inferredWarmth: estimateWarmth('Sweater', ['Wool'], 'Long'),
      inferredWind: estimateWind('Sweater', ['Wool'], 'Long'),
    });
    const polyesterTshirt = item('T-Shirt', {
      inferredWarmth: estimateWarmth('T-Shirt', ['Polyester'], 'Long'),
      inferredWind: estimateWind('T-Shirt', ['Polyester'], 'Long'),
    });
    const leatherBoots = item('Boots', {
      inferredWarmth: estimateWarmth('Boots', ['Leather']),
      inferredWind: estimateWind('Boots', ['Leather']),
    });
    const woolCoat = item('Coat', {
      inferredWarmth: estimateWarmth('Coat', ['Wool'], 'Short', 'Long'),
      inferredWind: estimateWind('Coat', ['Wool'], 'Short', 'Long'),
    });

    const results = generateClosestOutfits(
      emptyCandidates({
        bottoms: [jeans],
        tops: [woolSweater, polyesterTshirt],
        shoes: [leatherBoots],
        outerwear: [woolCoat],
      }),
      noDismatches,
      floor,
      ceiling,
      wFloor,
      100,
    );

    // Requiring the Sweater alongside the Coat in both branches is what
    // isolates "with vs. without the T-shirt base layer" -- without it, a
    // T-shirt-only (no Sweater) outfit would also match "has a T-shirt".
    const sweaterAndCoat = results.filter(
      (outfit) =>
        outfit.items.some((i) => i.id === woolSweater.id) && outfit.items.some((i) => i.id === woolCoat.id),
    );
    const withCoatAndTshirt = sweaterAndCoat.find((outfit) => outfit.items.some((i) => i.id === polyesterTshirt.id));
    const withCoatNoTshirt = sweaterAndCoat.find(
      (outfit) => !outfit.items.some((i) => i.id === polyesterTshirt.id),
    );

    // 23/21, not the original report's 24/22 -- Shoes no longer contribute
    // to sumWarmth at all (WARMTH_REGION_WEIGHT's Shoes weight moved from
    // 0.25 to 0, per later feedback that footwear shouldn't count toward
    // "how warm is this outfit"), so the boots' own inferredWarmth no
    // longer adds anything to either total. The regression itself --
    // both outfits clearing the ceiling -- still holds.
    expect(withCoatAndTshirt?.warmth).toBe(23);
    expect(withCoatAndTshirt?.meetsTarget).toBe(true);
    expect(withCoatNoTshirt?.warmth).toBe(21);
    expect(withCoatNoTshirt?.meetsTarget).toBe(true);
  });
});

describe('generateClosestOutfits: regression — a belt with no compatible bag must not outrank one with one', () => {
  // Reported bug: a Gold-hardware belt that had no matching bag kept beating
  // a Silver-hardware belt that did, for the same Top/Bottom pairing --
  // dismatching the Gold belt from its Gold bag just left every shown outfit
  // bagless, since selectDiverseOutfits (outfitDiversity.ts) treats outfits
  // that differ only by Belt as the same combo and keeps just the top-ranked
  // one. Belt and Bag both contribute 0 warmth (see outfitScoring.ts), so
  // without a tie-break on accessory count, the two belts tied on every
  // weather measure and whichever the search visited first (pool order) won
  // regardless of whether it could carry a bag at all.
  it('ranks the belt that can carry a compatible bag ahead of one that cannot', () => {
    const bottom = item('Pants', { hasBeltLoops: true });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    // Gold sorts first in pool order (accessoryFirst preserves insertion
    // order for untouched items), so without the fix this is the one that
    // would win the tie.
    const goldBelt = item('Belt', { hardwareColor: 'Gold' });
    const silverBelt = item('Belt', { hardwareColor: 'Silver' });
    const silverBag = item('Bag', { hardwareColor: 'Silver' });

    const results = generateClosestOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        belts: [goldBelt, silverBelt],
        bags: [silverBag],
      }),
      noDismatches,
      0,
      NO_CEILING,
      0,
    );

    // Belt is required, so every result has one -- the fix is about which
    // belt (and whether a bag comes with it) ranks first.
    const best = results[0];
    expect(best.items.some((i) => i.id === silverBelt.id)).toBe(true);
    expect(best.items.some((i) => i.id === silverBag.id)).toBe(true);
  });
});

describe('generateOutfits: regression — a lighter Outerwear option must not be excluded from the pool by heavier ones', () => {
  // Reported bug: a mild-cool day's warmth window (e.g. 14-20) found no
  // outfit at all even though the wardrobe had a light jacket that would
  // have bridged it -- the Outerwear slot used to rank candidates
  // heaviest-first and keep only the top MAX_ACCESSORY_CANDIDATES (3), so a
  // light jacket never entered the search once the closet held 3 warmer
  // coats, regardless of what any given day's ceiling could actually fit.
  it('finds an outfit using a light jacket when every heavier coat would overshoot the ceiling', () => {
    // inferredWarmth: 3 on the bottom -- not 0 -- so the leg-region floor
    // (meetsRegionFloors in outfitScoring.ts, unaffected by Outerwear) clears
    // regardless of what fills the Outerwear slot, and Outerwear choice is
    // the only thing this fixture's meetsTarget outcome actually depends on.
    const bottom = item('Pants', { inferredWarmth: 3, inferredWind: 2 });
    const top = item('Sweater', { inferredWarmth: 5, inferredWind: 2 });
    const shoes = item('Boots', { inferredWarmth: 2, inferredWind: 3 });
    const lightJacket = item('Jacket', { inferredWarmth: 3, inferredWind: 3 });
    const heavyCoats = Array.from({ length: 3 }, () => item('Coat', { inferredWarmth: 9, inferredWind: 8 }));

    const bareWarmth = sumWarmth([top, bottom, shoes]);
    const withLightJacket = sumWarmth([top, bottom, shoes, lightJacket]);
    const withHeavyCoat = sumWarmth([top, bottom, shoes, heavyCoats[0]]);

    // A floor just above bare (rules out no-outerwear) and a ceiling just at
    // the light-jacket total but below the heavy-coat total (rules out
    // every heavy coat) -- only the light jacket can bridge the gap. If this
    // assertion ever fails, the fixture's numbers no longer isolate the bug
    // and need adjusting, not the assertions below it.
    const floor = Math.ceil(bareWarmth) + 1;
    const ceiling = Math.ceil(withLightJacket);
    expect(withHeavyCoat).toBeGreaterThan(ceiling);

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        outerwear: [...heavyCoats, lightJacket],
      }),
      noDismatches,
      floor,
      ceiling,
      0,
    );

    expect(results.some((outfit) => outfit.some((i) => i.id === lightJacket.id))).toBe(true);
  });

  // Reported bug (v2): fixing the above by splitting the existing
  // heaviest-3 pool between both ends (rather than adding the leanest
  // option on top of it) shrank heavy-coat coverage to just the single
  // highest-insulation item -- a wool coat that wasn't literally that one
  // item (edged out by, say, a windproof shell scoring higher on
  // warmth+wind combined despite being less warm on its own) dropped out of
  // the search at every cold temperature, not just the one being fixed.
  it('still finds every one of several heavier coats, not just the single warmest by combined insulation', () => {
    // inferredWarmth high enough on the bottom and top that the leg- and
    // torso-region floors (meetsRegionFloors) clear at this test's floor
    // regardless of which coat fills Outerwear -- outerwear doesn't count
    // toward either region floor, so only its effect on total warmth is
    // what this fixture's meetsTarget outcome depends on.
    const bottom = item('Pants', { inferredWarmth: 6, inferredWind: 2 });
    const top = item('Sweater', { inferredWarmth: 8, inferredWind: 2 });
    const shoes = item('Boots', { inferredWarmth: 2, inferredWind: 3 });
    const lightJacket = item('Jacket', { inferredWarmth: 2, inferredWind: 2 });
    // Highest combined insulation (15), but the least warmth of the three
    // heavier options -- exactly the item a naive "single warmest" pool
    // would keep instead of the wool coat.
    const windproofShell = item('Jacket', { inferredWarmth: 5, inferredWind: 10 });
    const woolCoat = item('Coat', { inferredWarmth: 10, inferredWind: 3 });
    const canvasCoat = item('Coat', { inferredWarmth: 6, inferredWind: 6 });

    const withShell = sumWarmth([top, bottom, shoes, windproofShell]);
    const withWoolCoat = sumWarmth([top, bottom, shoes, woolCoat]);
    // Sanity: only the wool coat's own warmth, not the shell's higher
    // combined insulation, can clear this floor.
    expect(withWoolCoat).toBeGreaterThan(withShell);
    const floor = Math.ceil(withShell) + 1;
    expect(floor).toBeLessThanOrEqual(withWoolCoat);

    const results = generateOutfits(
      emptyCandidates({
        bottoms: [bottom],
        tops: [top],
        shoes: [shoes],
        outerwear: [windproofShell, woolCoat, canvasCoat, lightJacket],
      }),
      noDismatches,
      floor,
      NO_CEILING,
      0,
    );

    expect(results.some((outfit) => outfit.some((i) => i.id === woolCoat.id))).toBe(true);
  });
});

describe('generateOutfits: regression — warm boots must not be excluded from the required Shoes slot by lighter ones', () => {
  // Reported bug: no outfit at all at several cold temperatures (down to and
  // below 0°C), even though the wardrobe had boots warm enough to close the
  // gap -- Shoes used plain leanFirst (lightest-only, capped at
  // MAX_SLOT_CANDIDATES), the same blind spot floorAwareCandidates already
  // fixed for Top and the Bottom/Dress anchor, but Shoes is a *required*
  // slot: excluding the only warm-enough boots from its pool doesn't just
  // drop an optional layer, it fails every branch of the search outright.
  //
  // Tests floorAwareCandidates(shoeCandidatesFor(...)) directly, the
  // exact pool the Shoes slot in outfitSlots.ts's buildSlots is built
  // from, rather than routing through a whole-outfit warmth floor via
  // generateOutfits/sumWarmth -- Shoes no longer contributes to sumWarmth
  // at all (WARMTH_REGION_WEIGHT's Shoes weight is 0, per later feedback
  // that footwear shouldn't count toward "how warm is this outfit"), so a
  // sum-based floor can no longer force the search to require a warmer
  // pair the way it once could. The candidate-pool logic this regression
  // is actually about is untouched by that change, since floorAwareCandidates
  // ranks by each item's own raw inferredWarmth against the passed target,
  // not through WARMTH_REGION_WEIGHT/sumWarmth.
  it('includes warm boots in the Shoes candidate pool when six lighter pairs would otherwise fill it', () => {
    const lightShoes = Array.from({ length: 6 }, () => item('Boots', { inferredWarmth: 0, inferredWind: 0 }));
    const warmBoots = item('Boots', { inferredWarmth: 6, inferredWind: 5 });
    const candidates = emptyCandidates({ shoes: [...lightShoes, warmBoots] });

    const pool = floorAwareCandidates(shoeCandidatesFor(candidates, 6), 6);

    expect(pool.some((i) => i.id === warmBoots.id)).toBe(true);
  });
});

describe('generateClosestOutfits anchorPool override', () => {
  it('searches exactly the given anchorPool instead of computing its own', () => {
    const overrideBottom = item('Pants', { id: 'override-bottom' });
    const realBottom = item('Pants', { id: 'real-bottom' });
    const top = item('T-Shirt');
    const shoes = item('Shoes');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [realBottom], tops: [top], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
      new Map(),
      { anchorPool: [overrideBottom] },
    );

    const bottomIdsUsed = new Set(results.map((o) => o.items.find((i) => i.category === 'Pants')?.id));
    expect(bottomIdsUsed).toEqual(new Set(['override-bottom']));
  });
});

describe('generateClosestOutfits includeWarmthAccessories/topCandidatesOverride pass-through', () => {
  it('never includes a Scarf or Tights item when includeWarmthAccessories is false', () => {
    const bottom = item('Skirt', { inferredWarmth: 0 });
    const top = item('T-Shirt');
    const shoes = item('Shoes');
    const scarf = item('Scarf', { id: 'scarf-1' });
    const tights = item('Tights', { id: 'tights-1' });

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top], shoes: [shoes], scarves: [scarf], tights: [tights] }),
      noDismatches,
      10,
      NO_CEILING,
      0,
      10,
      new Map(),
      { includeWarmthAccessories: false },
    );

    for (const outfit of results) {
      expect(outfit.items.some((i) => i.category === 'Scarf' || i.category === 'Tights')).toBe(false);
    }
  });

  it('uses topCandidatesOverride for every anchor tried, not just the first', () => {
    const overrideTop = item('Shirt', { id: 'override-top' });
    const bottomA = item('Pants', { id: 'bottom-a' });
    const bottomB = item('Pants', { id: 'bottom-b' });
    const shoes = item('Shoes');

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops: [item('Shirt', { id: 'real-top' })], shoes: [shoes] }),
      noDismatches,
      0,
      NO_CEILING,
      0,
      10,
      new Map(),
      { topCandidatesOverride: [overrideTop] },
    );

    const topIdsUsed = new Set(results.map((o) => o.items.find((i) => i.category === 'Shirt')?.id));
    expect(topIdsUsed).toEqual(new Set(['override-top']));
  });
});

describe('generateClosestOutfits', () => {
  it('prunes a branch that has accumulated warmth well past the ceiling across several slots, while still finding a normal near-miss just outside it', () => {
    // Reported bug: generateClosestOutfits' isViable was hardcoded () =>
    // true (no pruning at all), which combined with the prior session's
    // pool-widening fix (BAND_POOL_SLOT_SIZE 6->15) blew the search from
    // ~885K to ~8M leaves, freezing the app on-device. topUpToward only
    // ever ADDS warmth (utils/warmthTopUp.ts), so an outfit already far
    // over the ceiling can never become valid regardless of what runs
    // later -- pruning it changes nothing about which outfits are
    // reachable, only how much dead search gets explored to confirm that.
    //
    // Fixture note: Cardigan/BaseLayer/Scarf/Bag candidate pools are NOT
    // themselves ceiling-filtered at construction (see cardiganCandidates/
    // baseLayerCandidates/accessoryFirst in outfitCandidatePools.ts --
    // unlike Top/Shoes/Outerwear, which are). A single absurdly-warm item
    // in a ceiling-filtered pool never reaches the DFS at all, so it can't
    // exercise this prune -- the real blowup this bug caused comes from
    // several individually-reasonable items STACKING across multiple
    // unfiltered optional slots. The Top slot is a plain 'Top' (not
    // 'Sweater'): a Sweater can never layer with a Cardigan at all (see
    // utils/layering.ts's LAYER_PAIRS/prohibitions), so pairing them
    // wouldn't reach this prune either -- it would just never be a
    // candidate outfit in the first place, pruned or not. warmthFloor=8
    // (>=7, so Scarf is offered) and warmthCeiling=10: sumWarmth applies
    // WARMTH_REGION_WEIGHT (outfitScoring.ts) per region, not a raw sum --
    // bottom(2*0.6)+top(2*1)+shoes(0*0)=3.2, comfortably under margin;
    // stacking Cardigan(12*1=12)+Scarf(12*0.8=9.6)+Outerwear(12*1=12) on
    // top of that reaches 36.8, past ceiling(10)+margin(20)=30 -- that
    // specific stacked combination should be pruned, while a leaner
    // combination (just Top+Scarf, 12.8) still gets found.
    const bottom = item('Pants', { id: 'bottom-1', inferredWarmth: 2 });
    const top = item('Top', { id: 'top-1', inferredWarmth: 2 });
    const shoes = item('Shoes', { id: 'shoes-1', inferredWarmth: 0 });
    const cardigan = item('Cardigan', { id: 'cardigan-1', inferredWarmth: 12 });
    const scarf = item('Scarf', { id: 'scarf-1', inferredWarmth: 12 });
    const outerwear = item('Jacket', { id: 'jacket-1', inferredWarmth: 12 });

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottom], tops: [top, cardigan], shoes: [shoes], outerwear: [outerwear], scarves: [scarf] }),
      noDismatches,
      8,
      10,
      0,
      Infinity,
    );

    const usesAll = (o: (typeof results)[number]) =>
      o.items.some((i) => i.id === 'cardigan-1') && o.items.some((i) => i.id === 'scarf-1') && o.items.some((i) => i.id === 'jacket-1');
    const usesScarfOnly = (o: (typeof results)[number]) =>
      o.items.some((i) => i.id === 'scarf-1') && !o.items.some((i) => i.id === 'cardigan-1') && !o.items.some((i) => i.id === 'jacket-1');

    expect(results.some(usesAll)).toBe(false);
    expect(results.some(usesScarfOnly)).toBe(true);
  });

  it('caps how many complete outfits it collects per bottom+top pair, without starving a different pair', () => {
    // Reported bug (Task 2's real-CSV benchmark): coreOutfitsForBands
    // returned 77,850 outfits at 0C/21kph -- not from unpruned DFS
    // branches (Task 1 already fixed that), but from the accessory slots
    // (Cardigan/BaseLayer/Outerwear/Bag) genuinely producing hundreds of
    // valid, distinct combinations per bottom+top pair, every one of
    // which then gets topped-up and re-sorted 3x downstream.
    //
    // Fixture: 2 bottoms, 1 top, 12 Outerwear + 6 Bag options -- (12
    // Outerwear + skip) x (6 Bag + skip) = 91 distinct completions per
    // bottom, comfortably exceeding MAX_RESULTS_PER_TOP_PAIR (60 -- see
    // that constant's own doc comment for why it landed there rather than
    // the plan's original 12: a smaller fixture closer to 12's own
    // headroom hit real pre-existing-test regressions, see below).
    const bottomA = item('Pants', { id: 'bottom-a', inferredWarmth: 1 });
    const bottomB = item('Pants', { id: 'bottom-b', inferredWarmth: 1 });
    const top = item('Sweater', { id: 'top-1', inferredWarmth: 1 });
    const shoes = item('Shoes', { id: 'shoes-1', inferredWarmth: 0 });
    const outerwear = Array.from({ length: 12 }, (_, i) => item('Jacket', { id: `jacket-${i}`, inferredWarmth: 1 }));
    const bags = Array.from({ length: 6 }, (_, i) => item('Bag', { id: `bag-${i}` }));

    const results = generateClosestOutfits(
      emptyCandidates({ bottoms: [bottomA, bottomB], tops: [top], shoes: [shoes], outerwear, bags }),
      noDismatches,
      1,
      10,
      0,
      Infinity,
    );

    const countFor = (bottomId: string) => results.filter((o) => o.items.some((i) => i.id === bottomId)).length;

    expect(countFor('bottom-a')).toBeLessThanOrEqual(60);
    expect(countFor('bottom-b')).toBeLessThanOrEqual(60);
    expect(countFor('bottom-a')).toBeGreaterThan(0);
    expect(countFor('bottom-b')).toBeGreaterThan(0); // proves bottom-b wasn't starved by bottom-a's own budget
  });
});
