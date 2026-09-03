/** @jest-environment node */
import fs from 'fs';
import { outfitsFor } from '../../contexts/TodayDataContext';
import type { TodayCandidates } from '../../services/outfitGenerator';
import { warmthFloor, warmthCeiling, windFloor as windFloorFn } from '../thermal';
import { coreOutfitsForBands, toppedUpForBand } from '../bandedOutfits';
import { splitIntoWarmthBands } from '../warmthBands';
import type { ClothingItem, Category, ItemColor, HardwareColor, SleeveLength, Thickness } from '../../types/wardrobe';
import { CATEGORY_GROUP } from '../categories';

/**
 * Permanent real-wardrobe regression sweep -- see the design spec's
 * "Permanent real-wardrobe regression sweep" section for the full
 * rationale. Replaces the pattern of writing and deleting a throwaway
 * diagnostic script for each investigation: this file is checked in, runs
 * as part of the normal suite, and sweeps a representative range of
 * temperatures/wind/filter combinations against the user's real wardrobe
 * export, asserting structural invariants (never exact item identities or
 * warmth values, which would make this brittle against future wardrobe
 * edits) that this session's real bugs all violated.
 */

const CSV_PATH = `${__dirname}/../../../docs/wardrobe-export.csv`;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else { cur += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
}

const COLUMNS = [
  'brand', 'category', 'primaryColor', 'secondaryColor', 'material1', 'material1Percent',
  'material2', 'material2Percent', 'hardwareColor', 'hasBeltLoops', 'sleeveLength', 'length',
  'thickness', 'denier', 'backless', 'inferredWarmth', 'inferredWind', 'isWorkAppropriate',
] as const;

function parseCsv(path: string): ClothingItem[] {
  const raw = fs.readFileSync(path, 'utf8');
  const lines = raw.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  const [, ...rows] = lines;
  return rows.map((line, idx) => {
    const fields = parseCsvLine(line);
    const rec: Record<string, string> = {};
    COLUMNS.forEach((col, i) => { rec[col] = (fields[i] ?? '').trim(); });
    const materials = [];
    if (rec.material1) materials.push({ material: rec.material1, percent: Number(rec.material1Percent) || 0 });
    if (rec.material2) materials.push({ material: rec.material2, percent: Number(rec.material2Percent) || 0 });
    return {
      id: `csv-${idx}`, imagePath: '', originalImagePath: '', imageMarginBaked: false,
      category: rec.category as Category, brand: rec.brand, costMinorUnits: 0, isSecondHand: false,
      purchasedAt: '', materials, primaryColor: rec.primaryColor as ItemColor | '',
      secondaryColor: rec.secondaryColor as ItemColor | '', hardwareColor: (rec.hardwareColor || 'None') as HardwareColor,
      hasBeltLoops: rec.hasBeltLoops === 'true', sleeveLength: (rec.sleeveLength || 'Short') as SleeveLength,
      length: rec.length as any, thickness: (rec.thickness || 'Regular') as Thickness,
      denier: Number(rec.denier) || 0, backless: rec.backless === 'true',
      inferredWarmth: Number(rec.inferredWarmth) || 0, inferredWind: Number(rec.inferredWind) || 0,
      wearCount: 0, createdAt: new Date().toISOString(), archivedAt: '',
      isWorkAppropriate: rec.isWorkAppropriate === 'true',
    } as ClothingItem;
  });
}

function buildCandidates(items: ClothingItem[]) {
  const byGroup = (group: string) => items.filter((i) => CATEGORY_GROUP[i.category] === group);
  return {
    bottoms: [...byGroup('Bottom'), ...byGroup('Dress')], tops: byGroup('Top'), shoes: byGroup('Shoes'),
    outerwear: byGroup('Outerwear'), scarves: byGroup('Scarf'), belts: byGroup('Belt'),
    bags: byGroup('Bag'), tights: byGroup('Tights'),
  };
}

const TEMPERATURES_C = [-10, -5, 0, 5, 10, 15, 17, 19, 20, 21, 25, 29, 35];
const WIND_SPEEDS_KPH = [0, 21];
const FILTER_STATES = [false, true];

const ITEMS = parseCsv(CSV_PATH);
const CANDIDATES = buildCandidates(ITEMS);
const TODAY_CANDIDATES: TodayCandidates = { candidates: CANDIDATES, dismatchedKeys: new Set(), wornDaysAgo: new Map() };

interface Scenario {
  feltTempC: number;
  windSpeedKph: number;
  workAppropriateOnly: boolean;
}

function allScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const feltTempC of TEMPERATURES_C) {
    for (const windSpeedKph of WIND_SPEEDS_KPH) {
      for (const workAppropriateOnly of FILTER_STATES) {
        scenarios.push({ feltTempC, windSpeedKph, workAppropriateOnly });
      }
    }
  }
  return scenarios;
}

function filteredCandidates(workAppropriateOnly: boolean) {
  if (!workAppropriateOnly) return CANDIDATES;
  const only = (items: readonly ClothingItem[]) => items.filter((i) => i.isWorkAppropriate);
  return {
    bottoms: only(CANDIDATES.bottoms), tops: only(CANDIDATES.tops), shoes: only(CANDIDATES.shoes),
    outerwear: only(CANDIDATES.outerwear), scarves: only(CANDIDATES.scarves), belts: only(CANDIDATES.belts),
    bags: only(CANDIDATES.bags), tights: only(CANDIDATES.tights),
  };
}

describe('real wardrobe regression sweep', () => {
  it('every item that could fit under some swept ceiling enters the core search at least once across the sweep', () => {
    const everSeen = new Set<string>();
    for (const { feltTempC, windSpeedKph, workAppropriateOnly } of allScenarios()) {
      const candidates = filteredCandidates(workAppropriateOnly);
      const floor = warmthFloor(feltTempC);
      const ceiling = warmthCeiling(feltTempC);
      const wFloor = windFloorFn(windSpeedKph, feltTempC);
      const bands = splitIntoWarmthBands(floor, ceiling);
      const core = coreOutfitsForBands(candidates, TODAY_CANDIDATES.dismatchedKeys, floor, ceiling, wFloor, bands, TODAY_CANDIDATES.wornDaysAgo);
      for (const outfit of core) {
        for (const outfitItem of outfit.items) everSeen.add(outfitItem.id);
      }
    }

    // A bottom's own weighted contribution alone (Bottom region weight is
    // 0.6 -- see WARMTH_REGION_WEIGHT in outfitScoring.ts) is the cheapest
    // possible check for "could this plausibly matter at some swept
    // ceiling" without re-deriving the full scoring pipeline here.
    const BOTTOM_REGION_WEIGHT = 0.6;
    const maxCeiling = Math.max(...TEMPERATURES_C.map((t) => warmthCeiling(t)));
    const plausibleBottoms = CANDIDATES.bottoms.filter((i) => i.inferredWarmth * BOTTOM_REGION_WEIGHT <= maxCeiling);

    const neverSeen = plausibleBottoms.filter((i) => !everSeen.has(i.id));
    if (neverSeen.length > 0) {
      const detail = neverSeen.map((i) => `${i.brand} ${i.category} (id=${i.id}, warmth=${i.inferredWarmth})`).join('\n  ');
      throw new Error(
        `${neverSeen.length} bottom(s) that could plausibly fit under some swept ceiling never entered the core search across the entire sweep:\n  ${detail}`,
      );
    }
  });
});

/** Reconstructs which tracked items an earlier-processed band's real picks already claimed, for the diagnostic trace below -- mirrors this session's own ad hoc investigation scripts. */
function claimedIdsExcluding(shown: ReturnType<typeof outfitsFor>['shown'], excludeBand: 'cooler' | 'median' | 'warmer'): Map<string, number> {
  const counts = new Map<string, number>();
  for (const outfit of shown) {
    if (outfit.band === excludeBand) continue;
    for (const outfitItem of outfit.items) {
      if (outfitItem.category === 'Tights' || outfitItem.category === 'Bag' || outfitItem.category === 'Belt' || outfitItem.category === 'Scarf') continue;
      counts.set(outfitItem.id, (counts.get(outfitItem.id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Every tracked (reuse-relevant) item id on `outfit` -- Tights/Bag/Belt/Scarf are excluded from reuse tracking entirely, see UNTRACKED_CATEGORIES in bandedOutfits.ts. */
function trackedIds(outfit: { items: readonly { id: string; category: string }[] }): string[] {
  return outfit.items
    .filter((i) => i.category !== 'Tights' && i.category !== 'Bag' && i.category !== 'Belt' && i.category !== 'Scarf')
    .map((i) => i.id);
}

/** How many independent redraws hasNonConflictingValidAlternative takes before accepting "no alternative exists" as genuine -- see that function's own doc comment. */
const SCARCITY_CONFIRMATION_ATTEMPTS = 5;

/**
 * One independent draw of coreOutfitsForBands/toppedUpForBand -- factored out
 * of hasNonConflictingValidAlternative so that function can retry it, since
 * coreOutfitsForBands' own evenlySampled pool is Math.random()-driven (see
 * bandedOutfits.ts) and two calls with identical inputs can legitimately
 * return different merged pools.
 */
function oneAlternativeDraw(
  band: 'cooler' | 'median' | 'warmer',
  scenario: Scenario,
  shown: ReturnType<typeof outfitsFor>['shown'],
  extraExcludeIds: ReadonlySet<string>,
): boolean {
  const candidates = filteredCandidates(scenario.workAppropriateOnly);
  const floor = warmthFloor(scenario.feltTempC);
  const ceiling = warmthCeiling(scenario.feltTempC);
  const wFloor = windFloorFn(scenario.windSpeedKph, scenario.feltTempC);
  const bands = splitIntoWarmthBands(floor, ceiling);
  const core = coreOutfitsForBands(candidates, TODAY_CANDIDATES.dismatchedKeys, floor, ceiling, wFloor, bands, TODAY_CANDIDATES.wornDaysAgo);
  const toppedUp = toppedUpForBand(core, bands[band], candidates, TODAY_CANDIDATES.dismatchedKeys, floor, ceiling, wFloor, TODAY_CANDIDATES.wornDaysAgo, new Map());
  const claimed = claimedIdsExcluding(shown, band);
  return toppedUp.some(
    (outfit) =>
      outfit.meetsTarget &&
      outfit.items.every((outfitItem) => {
        if (outfitItem.category === 'Tights' || outfitItem.category === 'Bag' || outfitItem.category === 'Belt' || outfitItem.category === 'Scarf') return true;
        if (extraExcludeIds.has(outfitItem.id)) return false;
        return (claimed.get(outfitItem.id) ?? 0) < 2;
      }),
  );
}

/**
 * Whether a genuinely valid, non-reuse-conflicting alternative existed for
 * `band` given what the other bands actually claimed -- the same trace this
 * session used repeatedly to distinguish a real bug from genuine wardrobe
 * scarcity.
 *
 * Retries the draw up to SCARCITY_CONFIRMATION_ATTEMPTS times and returns
 * true (an alternative existed -- a genuine failure) as soon as any attempt
 * finds one, only returning false (no alternative -- presumed scarcity)
 * once every attempt has come back empty. This is necessary, not just
 * belt-and-braces: coreOutfitsForBands (called by oneAlternativeDraw) now
 * depends on evenlySampled's Math.random()-driven bucket sampling (see
 * bandedOutfits.ts), so two calls with identical inputs can legitimately
 * return different merged pools -- a size-2 bucket only surfaces its item
 * ~50% of the time. A single draw here could therefore disagree with
 * whatever draw actually produced the `shown` result under test, purely
 * from randomness: reporting a spurious "genuine failure" (or the reverse,
 * under-reporting a real bug as scarcity) with no actual bug involved. Five
 * independent retries make a false "genuine scarcity" verdict from bad luck
 * alone astronomically unlikely (~0.5^5 ≈ 3% per single size-2-bucket miss,
 * compounding down further for any item that appears in more than one
 * bucket-sized gap) while keeping this helper -- only invoked when a
 * shortfall/repeat has ALREADY been observed, not on every scenario --
 * cheap relative to the sweep as a whole.
 *
 * `extraExcludeIds` additionally rules out specific item ids regardless of
 * claim count -- needed for the within-band-repeat check below, where the
 * "already claimed" set has to include the SAME band's own first pick.
 * claimedIdsExcluding(shown, band) alone can't express that: it drops any
 * outfit tagged with `band` (by design, for the shortfall check, which must
 * not count a not-yet-filled band's own claims against itself) -- so a naive
 * call with shown=[first] silently produces an empty claimed set (first gets
 * excluded because first.band === band), and the check degenerates into
 * "does any valid outfit exist for this band", not "does a fresh one exist
 * that avoids repeating first's own items". Caught by this test file's own
 * Step 4 run: a diagnostic instrumenting the un-fixed helper found it
 * reported an alternative in 20/20 independent redraws for a real,
 * consistently-reproducing repeat (the same Sweater in both of the cooler
 * band's picks), proving the helper -- not the algorithm -- was broken.
 */
function hasNonConflictingValidAlternative(
  band: 'cooler' | 'median' | 'warmer',
  scenario: Scenario,
  shown: ReturnType<typeof outfitsFor>['shown'],
  extraExcludeIds: ReadonlySet<string> = new Set(),
): boolean {
  for (let attempt = 0; attempt < SCARCITY_CONFIRMATION_ATTEMPTS; attempt++) {
    if (oneAlternativeDraw(band, scenario, shown, extraExcludeIds)) return true;
  }
  return false;
}

describe('real wardrobe regression sweep: shown count and reuse', () => {
  it('every scenario either shows 6 outfits, or a shortfall is proven to be genuine wardrobe scarcity', () => {
    const genuineFailures: string[] = [];
    for (const scenario of allScenarios()) {
      const result = outfitsFor(TODAY_CANDIDATES, scenario.feltTempC, scenario.windSpeedKph, scenario.workAppropriateOnly);
      if (result.shown.length >= 6) continue;
      const missingBands = (['cooler', 'median', 'warmer'] as const).filter(
        (band) => result.shown.filter((o) => o.band === band).length < 2,
      );
      for (const band of missingBands) {
        if (hasNonConflictingValidAlternative(band, scenario, result.shown)) {
          genuineFailures.push(
            `${scenario.feltTempC}C/${scenario.windSpeedKph}kph/workOnly=${scenario.workAppropriateOnly}: ${band} band short of 2 outfits despite a valid, non-conflicting alternative existing`,
          );
        }
      }
    }
    if (genuineFailures.length > 0) {
      throw new Error(`${genuineFailures.length} genuine shortfall(s) found (not explained by wardrobe scarcity):\n  ${genuineFailures.join('\n  ')}`);
    }
  });

  it('no item repeats within a single band\'s own 2 picks unless proven no fresh alternative existed', () => {
    const genuineFailures: string[] = [];
    for (const scenario of allScenarios()) {
      const result = outfitsFor(TODAY_CANDIDATES, scenario.feltTempC, scenario.windSpeedKph, scenario.workAppropriateOnly);
      for (const band of ['cooler', 'median', 'warmer'] as const) {
        const picks = result.shown.filter((o) => o.band === band);
        if (picks.length < 2) continue;
        const [first, second] = picks;
        const firstIds = new Set(trackedIds(first));
        const overlap = trackedIds(second).filter((id) => firstIds.has(id));
        if (overlap.length === 0) continue;
        if (!hasNonConflictingValidAlternative(band, scenario, result.shown, firstIds)) continue; // scarcity-driven repeat, expected
        genuineFailures.push(
          `${scenario.feltTempC}C/${scenario.windSpeedKph}kph/workOnly=${scenario.workAppropriateOnly}: ${band} band repeats ${overlap.join(',')} within its own 2 picks despite a fresh alternative existing`,
        );
      }
    }
    if (genuineFailures.length > 0) {
      throw new Error(`${genuineFailures.length} genuine within-band repeat(s) found (not explained by scarcity):\n  ${genuineFailures.join('\n  ')}`);
    }
  });
});
