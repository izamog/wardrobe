import type { Coordinates } from './location';

/**
 * Fetching today's forecast from Open-Meteo.
 *
 * Open-Meteo's free tier needs no API key and no account, so this is a plain
 * fetch with its own small timeout rather than anything built on
 * services/openai.ts's callOpenAI — that helper is OpenAI-specific (bearer
 * auth, VoiceError). Never throws: a forecast is an optimisation over
 * showing nothing, not a hard requirement, matching services/vision.ts's
 * "never throw" contract for the same reason.
 */

const FORECAST_TIMEOUT_MS = 15_000;

export interface DailyForecast {
  tempC: number;
  feltTempC: number;
  windSpeedKph: number;
}

function firstNumber(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first: unknown = value[0];
  return typeof first === 'number' && Number.isFinite(first) ? first : null;
}

function forecastUrl(coords: Coordinates): string {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(coords.latitude));
  url.searchParams.set('longitude', String(coords.longitude));
  url.searchParams.set('daily', 'temperature_2m_max,apparent_temperature_max,wind_speed_10m_max');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');
  return url.toString();
}

/** Pulls today's three numbers out of an Open-Meteo response body, or null if any is missing. */
function parseForecastBody(body: unknown): DailyForecast | null {
  const daily = (
    body as {
      daily?: {
        temperature_2m_max?: unknown;
        apparent_temperature_max?: unknown;
        wind_speed_10m_max?: unknown;
      };
    }
  ).daily;

  const tempC = firstNumber(daily?.temperature_2m_max);
  const feltTempC = firstNumber(daily?.apparent_temperature_max);
  const windSpeedKph = firstNumber(daily?.wind_speed_10m_max);
  if (tempC === null || feltTempC === null || windSpeedKph === null) return null;

  return { tempC, feltTempC, windSpeedKph };
}

/**
 * Cached by calendar day, not by coordinates: services/location.ts already
 * caches the device's fix for the process lifetime, so coordinates don't
 * change within a session, and a forecast doesn't need refetching every time
 * TodayScreen regains focus — only once the date rolls over.
 */
let cache: { date: string; forecast: DailyForecast } | null = null;

/**
 * Fetches today's max temperature, felt (apparent) temperature and max wind
 * speed for `coords`. `today` is the caller's own YYYY-MM-DD, so this stays
 * driven by the same date generateTodayOutfits uses rather than reading the
 * clock twice.
 */
export async function fetchTodayForecast(
  coords: Coordinates,
  today: string,
): Promise<DailyForecast | null> {
  if (cache?.date === today) return cache.forecast;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORECAST_TIMEOUT_MS);

  try {
    // coords come from expo-location, today from the local clock — neither is
    // user-supplied text, so this isn't a request-forgery risk.
    // nosemgrep
    const response = await fetch(forecastUrl(coords), { signal: controller.signal });
    if (!response.ok) return null;

    const forecast = parseForecastBody(await response.json());
    if (!forecast) return null;

    cache = { date: today, forecast };
    return forecast;
  } catch (e) {
    if (controller.signal.aborted) {
      console.warn('Forecast request timed out');
    } else {
      console.warn('Could not fetch forecast', e);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
