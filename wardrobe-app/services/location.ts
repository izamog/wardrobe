import * as Location from 'expo-location';

/**
 * The one module that touches expo-location.
 *
 * Not unit-testable off-device, same as services/images.ts — anything added
 * here has to be verified by running the app.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type LocationFailure = 'permission-denied' | 'unavailable';
export type LocationResult = { ok: true; coords: Coordinates } | { ok: false; reason: LocationFailure };

/**
 * Cached for the process lifetime.
 *
 * A GPS fix is slow and the forecast only needs city-level precision, so
 * re-reading it every time TodayScreen regains focus would cost latency for
 * no benefit. services/weather.ts caches the forecast itself on top of this.
 */
let cached: Coordinates | null = null;

/** Test seam: forget the cached fix. */
export function resetLocationCache(): void {
  cached = null;
}

/**
 * Returns the device's current coordinates, requesting permission if needed.
 *
 * Permission denial is a normal outcome, not an exception — reported in the
 * result so the caller can offer Settings, the same contract
 * services/images.ts's pickImage uses.
 */
export async function currentLocation(): Promise<LocationResult> {
  if (cached) return { ok: true, coords: cached };

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: 'permission-denied' };

  try {
    // A recent fix is fast and precise enough for a daily forecast; only
    // falls through to a fresh, low-accuracy read when none is cached at the
    // OS level yet (e.g. right after install).
    const known = await Location.getLastKnownPositionAsync();
    const position =
      known ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    cached = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    return { ok: true, coords: cached };
  } catch (e) {
    console.warn('Could not read location', e);
    return { ok: false, reason: 'unavailable' };
  }
}
