/**
 * Splitting today's valid warmth range into three equal-width bands, so
 * Today can deliberately offer a leaner, a "just right", and a warmer
 * option instead of six outfits that all happen to rank close to one
 * single target. Every band still sits fully inside [warmthFloor,
 * warmthCeiling] — bands steer preference among already-valid outfits,
 * they never redefine what counts as weather-valid (see
 * utils/outfitScoring.ts's meetsRegionFloors, checked against the real
 * warmthFloor regardless of which band an outfit ends up in).
 */
export interface WarmthBand {
  min: number;
  max: number;
  /** The band's own target — outfits assigned to this band are ranked (and topped up, see warmthTopUp.ts) by closeness to this point, not the single global target the rest of the search still uses for weather-validity. */
  center: number;
}

/** cooler = bottom third (leanest), median = center third ("just right"), warmer = top third — see WarmthBand's own doc comment. */
export function splitIntoWarmthBands(
  warmthFloor: number,
  warmthCeiling: number,
): { cooler: WarmthBand; median: WarmthBand; warmer: WarmthBand } {
  const span = warmthCeiling - warmthFloor;
  const third = span / 3;
  const band = (min: number, max: number): WarmthBand => ({ min, max, center: (min + max) / 2 });

  return {
    cooler: band(warmthFloor, warmthFloor + third),
    median: band(warmthFloor + third, warmthFloor + 2 * third),
    warmer: band(warmthFloor + 2 * third, warmthCeiling),
  };
}
