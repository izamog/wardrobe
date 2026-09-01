/**
 * Converting a weather forecast into bounds an outfit's weighted totals (see
 * sumWarmth/sumWind in utils/outfitGenerator.ts) are compared against.
 *
 * Warmth gets a floor *and* a ceiling; wind gets a floor only. There is no
 * physical downside to a more wind-resistant outfit — you don't overheat
 * from a windproof shell — but there very much is a downside to more warmth
 * than the weather calls for. A floor-only model of warmth has no way to
 * say an outfit is too warm, which is exactly backwards on a hot day: the
 * ceiling is what actually rejects a too-warm choice instead of merely
 * failing to prefer a cooler one.
 *
 * Not clamped to 0-10. That clamp made sense comparing one item's own score
 * to itself, but these bounds are compared against a *summed, weighted*
 * outfit total (utils/outfitGenerator.ts's sumWarmth/sumWind), which
 * routinely exceeds 10 once more than one garment counts toward it — a
 * torso item alone can reach 10, and a real outfit is several items. A
 * bound capped at 10 would already be trivially cleared by one warm sweater
 * regardless of the weather, which defeats the point of having a bound.
 *
 * None of the constants below are calibrated against real data — same
 * caveat the original spec put on its divisors. They're named and isolated
 * so retuning later is a one-line change, not a formula hunt.
 */

/** °C at or above which no extra warmth is needed at all. */
const WARMTH_NEUTRAL_TEMP_C = 20;

/**
 * How much the warmth floor rises per °C colder than neutral.
 *
 * Raised from an earlier 0.6, then 0.95: at 0.95, a jeans + wool sweater +
 * long-sleeve T-shirt base layer + boots outfit (14 summed, weighted warmth)
 * exactly cleared the floor at 5°C felt on its own — reported as a coat
 * being withheld from an outfit that needed one, because there was no
 * shortfall left for a coat to close (see WARMTH_CEILING_SLACK below for why
 * that made the coat actively *too warm* rather than merely unnecessary).
 * 1.2 pushes the floor at 5°C from 14 to 18, so that same sweater+T-shirt
 * combination (still 14) falls genuinely short, and a coat becomes the thing
 * that actually closes the gap rather than something with no gap left to
 * close.
 */
const WARMTH_UNITS_PER_DEGREE = 1.2;

/**
 * Highest the warmth floor can reach, however cold it gets.
 *
 * Raised from an earlier 16, then 30, in step with WARMTH_UNITS_PER_DEGREE
 * above, so the cap still only starts binding around the same kind of
 * extreme-cold felt temperature it did before (roughly -12°C and colder)
 * rather than clawing back most of the increase right where it matters.
 */
const WARMTH_FLOOR_MAX = 38;

/**
 * How far above its own floor the warmth ceiling sits.
 *
 * Flat, not proportional — which is what keeps the ceiling meaningful at
 * both ends. Narrowed from an earlier 6: that much slack meant an outfit
 * could clear the floor by a wide margin and still read as "within range"
 * rather than "overdressed," part of the same habitual-overwarmth pattern
 * WARMTH_UNITS_PER_DEGREE above addresses.
 *
 * Not narrowed all the way to 3: a torso item warm enough to clear its own
 * region floor (see REGION_WARMTH_FLOOR_FRACTION in outfitScoring.ts) plus
 * a bottom clearing its own, plus shoes, already costs on the order of 7 in
 * the weighted sum before any Outerwear is even added — a 3-wide band left
 * no room at all for a Jacket or Coat's own baseline on top of that once a
 * real base layer was already required, which made genuinely cold or windy
 * weather (where a coat is exactly what's needed) impossible to satisfy at
 * all rather than merely strict. 5 keeps the band meaningfully tighter than
 * the original 6 while leaving an Outerwear layer room to actually fit.
 *
 * This is the floor's own baseline slack, not the whole gap — see
 * COLD_CEILING_BONUS_MAX below for the part that grows in cold weather.
 */
const WARMTH_CEILING_SLACK = 5;

/**
 * Extra ceiling slack added on top of WARMTH_CEILING_SLACK as it gets
 * colder — 0 at/above WARMTH_NEUTRAL_TEMP_C, rising to this maximum once
 * warmthFloor itself is maxed out (WARMTH_FLOOR_MAX).
 *
 * Reported bug: a jeans + wool sweater + long-sleeve T-shirt base layer +
 * boots + coat outfit at 5°C (24 summed, weighted warmth) sat 1 point above
 * a flat floor+5 ceiling of 23 — the exact outfit a coat was added *to*
 * close a floor shortfall was itself rejected as overdressed, and so was the
 * same outfit with the base layer dropped (22, inside the flat ceiling, but
 * only by luck of that particular combination). A flat slack applies the
 * same tightness to a hot day, where it is doing real work rejecting a
 * single warm garment on its own (see warmthCeiling's stays-tight test), and
 * to a cold one, where a genuine layering system — base layer, mid-layer,
 * outerwear — legitimately needs more total room than a single hot-day
 * garment does. Scaling only the cold end leaves the hot-day case exactly as
 * tight as before (this term is 0 there) while giving cold weather the
 * extra room a real coat-plus-layers outfit needs.
 */
const COLD_CEILING_BONUS_MAX = 4;

/**
 * °C (felt) at or above which wind adds nothing to the wind floor at all.
 *
 * feltTempC is already a wind-chill-adjusted "apparent temperature" (see
 * services/weather.ts — it comes straight from Open-Meteo's own apparent
 * temperature, which factors in wind speed), and warmthFloor is built from
 * it. A separate windFloor that ignored temperature was applying a second,
 * independent penalty for the exact same wind that had already lowered
 * warmthFloor — a 22°C day with a 19kph breeze reads as 20°C felt (the
 * chill already counted once), but the old windFloor formula still asked
 * for near-maximum wind-blocking construction on top of that, which no
 * plausible mild-weather outfit could reach without busting the (correctly
 * low) warmth ceiling. Wind is only a *separate* concern from warmth once
 * it's cold enough that a gust through a loose or mesh garment is itself
 * unpleasant, not merely "a breeze" — 15°C is treated as roughly that point.
 */
const WIND_NEUTRAL_TEMP_C = 15;

/**
 * Degrees below WIND_NEUTRAL_TEMP_C at which the wind floor reaches its full
 * weight. Below neutral, the wind floor is scaled by how much of this span
 * has been crossed — 0 right at neutral, 1 once feltTempC is this many
 * degrees colder — rather than snapping on and off at a hard cutoff.
 */
const WIND_COLDNESS_SPAN_C = 15;

/**
 * kph at or above which the wind floor stops rising, before the coldness
 * scaling is applied.
 *
 * Raised from an earlier 45: at anything below full coldness scaling (which
 * only reaches 1 at WIND_COLDNESS_SPAN_C degrees below neutral), the discount
 * applied before this cap meant a 45kph gust and an 80kph gale produced
 * close to the same floor once both were capped at the same 45 — a real
 * strong-gale day and a merely blustery one asked for the same wind
 * protection. 80 lets a genuine gale still be distinguished from a breeze
 * after the coldness scaling below.
 */
const WIND_FLOOR_MAX_KPH = 80;

/**
 * How much the (coldness-scaled) wind floor rises per kph.
 *
 * Raised from an earlier 0.25, which — combined with the old 45kph cap —
 * let a cold, genuinely gale-force day (10°C felt, 80kph) demand only a
 * floor of 4 out of a possible 12: comfortably cleared by a single jacket
 * while a bare-legged skirt and open sandals sat alongside it. 0.4 with the
 * higher cap above pushes the same conditions close to the maximum, which is
 * what a strong gale should actually require.
 */
const WIND_UNITS_PER_KPH = 0.4;

/** Highest the wind floor can reach, however cold and windy it gets. */
const WIND_FLOOR_MAX = 12;

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** 0 at or above WIND_NEUTRAL_TEMP_C, rising to 1 by WIND_COLDNESS_SPAN_C degrees colder. */
function windColdnessFactor(feltTempC: number): number {
  const belowNeutral = WIND_NEUTRAL_TEMP_C - feltTempC;
  return Math.min(1, Math.max(0, belowNeutral / WIND_COLDNESS_SPAN_C));
}

/** The least summed, weighted warmth an outfit needs to cover today's felt temperature. */
export function warmthFloor(feltTempC: number): number {
  return clamp(Math.max(0, WARMTH_NEUTRAL_TEMP_C - feltTempC) * WARMTH_UNITS_PER_DEGREE, WARMTH_FLOOR_MAX);
}

/** The most summed, weighted warmth an outfit should have before it's overdressed for today. */
export function warmthCeiling(feltTempC: number): number {
  const floor = warmthFloor(feltTempC);
  const coldBonus = Math.round((floor / WARMTH_FLOOR_MAX) * COLD_CEILING_BONUS_MAX);
  return floor + WARMTH_CEILING_SLACK + coldBonus;
}

/**
 * The least summed, weighted wind resistance an outfit needs, given today's
 * wind speed and felt temperature.
 *
 * feltTempC is what scales this down to 0 on a mild or warm day regardless of
 * how windy it is — see WIND_NEUTRAL_TEMP_C for why. It is not an optional
 * parameter with a "neutral" default the way sleeveLength's is: there is no
 * wind speed that means anything about comfort without knowing whether it's
 * cold enough for wind to matter, so a caller must always supply both.
 */
export function windFloor(windSpeedKph: number, feltTempC: number): number {
  const cappedSpeed = Math.min(windSpeedKph, WIND_FLOOR_MAX_KPH);
  return clamp(windColdnessFactor(feltTempC) * cappedSpeed * WIND_UNITS_PER_KPH, WIND_FLOOR_MAX);
}
