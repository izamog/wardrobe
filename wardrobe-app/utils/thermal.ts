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

/** How much the warmth floor rises per °C colder than neutral. */
const WARMTH_UNITS_PER_DEGREE = 0.6;

/** Highest the warmth floor can reach, however cold it gets. */
const WARMTH_FLOOR_MAX = 16;

/**
 * How far above its own floor the warmth ceiling sits.
 *
 * Flat, not proportional — which is what keeps the ceiling meaningful at
 * both ends. At a floor of 0 (hot day) a ceiling of floor + 6 = 6 is tight
 * enough to reject a genuinely warm piece on its own. At a floor of 16
 * (extreme cold) the same +6 gives a ceiling of 22, comfortably above what
 * a fully bundled outfit sums to — real cold weather has no meaningful
 * "too warm" failure mode the way a hot day does, and the flat slack is
 * what keeps the ceiling from fighting the floor instead of the weather.
 */
const WARMTH_CEILING_SLACK = 6;

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

/** kph at or above which the wind floor stops rising, before the coldness scaling is applied. */
const WIND_FLOOR_MAX_KPH = 45;

/** How much the (coldness-scaled) wind floor rises per kph. */
const WIND_UNITS_PER_KPH = 0.25;

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
  return warmthFloor(feltTempC) + WARMTH_CEILING_SLACK;
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
