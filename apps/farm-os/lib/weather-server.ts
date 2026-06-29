import "server-only"; // §2 control 1: importing this (WEATHER_API_KEY-bearing) module into a Client
// Component FAILS the build — the key is server-only enforced, not just documented. Mirrors
// lib/supabase/admin.ts and lib/seed-auth.ts.

// Stage 9 (SPEC-0007) — server-side forecast fetch. SECRET HYGIENE (§2.1): the key lives in
// WEATHER_API_KEY (no NEXT_PUBLIC_ prefix → Next never bundles it to the client); the browser calls OUR
// server component, never the provider. The provider response is parsed through parseForecast (the
// trust boundary in lib/weather.ts) — never trusted raw. A missing key or a feed outage returns an
// empty result (graceful degradation §2.4), never a throw. No outbound-send / no sensitive-write here
// (no-trifecta §2.3). This module must only ever be imported by Server Components / server code.

import { parseForecast, type Forecast } from "./weather";

export interface WeatherResult {
  configured: boolean; // false ⇒ WEATHER_API_KEY/URL not set (Owner provides — SPEC §5.1)
  forecasts: Forecast[];
  error?: string;
}

function n(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Map ONE provider day to our normalized {date,tempC,windKph,rainMm,humidityPct}. The Owner adapts
 * this to their chosen provider (SPEC §5.1); the default targets an OpenWeather One-Call `daily` entry
 * (temp.day °C, wind_speed m/s → km/h, rain mm, humidity %). Whatever it returns is still re-validated
 * by parseForecast, so a wrong mapping fails safe (the day is dropped, not trusted).
 */
function mapProviderDay(d: unknown): unknown {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const temp = o.temp as { day?: unknown } | number | undefined;
  const tempC = typeof temp === "number" ? temp : n((temp as { day?: unknown })?.day);
  const windMs = n(o.wind_speed);
  return {
    date:
      typeof o.dt === "number"
        ? new Date(o.dt * 1000).toISOString()
        : typeof o.date === "string"
          ? o.date
          : "",
    tempC,
    windKph: windMs !== undefined ? windMs * 3.6 : n(o.windKph),
    rainMm: n(o.rain) ?? n(o.rainMm) ?? 0,
    humidityPct: n(o.humidity) ?? n(o.humidityPct),
  };
}

/** Fetch + strict-parse the multi-day forecast. Never throws; degrades to an empty list on any failure. */
export async function getForecast(): Promise<WeatherResult> {
  const key = process.env.WEATHER_API_KEY;
  const url = process.env.WEATHER_API_URL; // e.g. https://api.openweathermap.org/...&appid={key}
  if (!key || !url) return { configured: false, forecasts: [] };
  try {
    // §2 control 4 (graceful degradation): cap the fetch at 8s so a hung provider can't stall the
    // Server-Component-rendered /weather page indefinitely. AbortSignal.timeout fires an AbortError,
    // which the catch below turns into a graceful configured:true/fetch_failed result (never a throw).
    const res = await fetch(url.replace("{key}", key), {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { configured: true, forecasts: [], error: "provider_error" };
    const json: unknown = await res.json();
    const root = json as { daily?: unknown };
    const days = Array.isArray(root?.daily) ? root.daily : Array.isArray(json) ? (json as unknown[]) : [];
    const forecasts: Forecast[] = [];
    for (const d of days.slice(0, 14)) {
      const f = parseForecast(mapProviderDay(d)); // re-validate every field; reject anything off
      if (f) forecasts.push(f);
    }
    return { configured: true, forecasts };
  } catch {
    return { configured: true, forecasts: [], error: "fetch_failed" };
  }
}
