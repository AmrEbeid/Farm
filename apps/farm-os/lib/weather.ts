// Stage 9 (SPEC-0007) — weather core: parse an UNTRUSTED forecast payload safely, and compute
// operation gates from EDITABLE agronomic thresholds. Pure + framework-free so it is unit-tested
// independently (the acceptance oracle) and so the same trust boundary is reused by any caller.
//
// SECURITY (SPEC-0007 §2): the provider response is untrusted external content. This module is the
// trust boundary: parseForecast extracts ONLY the five known numeric fields + a bounded date, range-
// checks every one, and rejects anything malformed/oversized. It NEVER reads free-text fields, never
// `eval`s, never returns provider strings — so an injected instruction in the payload is inert data.
// It has no I/O (no fetch, no DB, no send) — the no-trifecta rule holds by construction.

export interface Forecast {
  date: string; // YYYY-MM-DD (validated, bounded length)
  tempC: number;
  windKph: number;
  rainMm: number;
  humidityPct: number;
}

// Plausibility envelopes — a value outside these is rejected as garbage/hostile, not stored. Exported
// so a saved-threshold write path (app/(app)/weather/thresholds/actions.ts) can pre-validate against
// the SAME envelopes as the forecast fields they gate against, instead of duplicating magic numbers.
export const RANGE = {
  tempC: [-40, 60],
  windKph: [0, 400],
  rainMm: [0, 2000],
  humidityPct: [0, 100],
} as const;

const MAX_DATE_LEN = 32; // reject oversized "date" strings (injection / DoS surface)

function finiteInRange(v: unknown, lo: number, hi: number): number | null {
  // only a real, finite number passes — strings/objects/NaN/Infinity are rejected (never coerced).
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

/**
 * Strict-parse one forecast day from an UNTRUSTED value. Returns a clean Forecast or `null` — never
 * throws, never trusts free text. Only the five known fields are read; everything else (descriptions,
 * extra keys, nested objects) is ignored. A null result MUST be treated as "unknown" by callers.
 */
export function parseForecast(raw: unknown): Forecast | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  // date: a bounded string that parses to a real calendar date; normalise to YYYY-MM-DD.
  if (typeof o.date !== "string" || o.date.length === 0 || o.date.length > MAX_DATE_LEN) return null;
  const t = Date.parse(o.date);
  if (Number.isNaN(t)) return null;
  const date = new Date(t).toISOString().slice(0, 10);

  const tempC = finiteInRange(o.tempC, RANGE.tempC[0], RANGE.tempC[1]);
  const windKph = finiteInRange(o.windKph, RANGE.windKph[0], RANGE.windKph[1]);
  const rainMm = finiteInRange(o.rainMm, RANGE.rainMm[0], RANGE.rainMm[1]);
  const humidityPct = finiteInRange(o.humidityPct, RANGE.humidityPct[0], RANGE.humidityPct[1]);
  if (tempC === null || windKph === null || rainMm === null || humidityPct === null) return null;

  return { date, tempC, windKph, rainMm, humidityPct };
}

/** Parse a list of forecast days, dropping any malformed entry (the feed may be partially garbage). */
export function parseForecastList(raw: unknown): Forecast[] {
  if (!Array.isArray(raw)) return [];
  const out: Forecast[] = [];
  for (const r of raw.slice(0, 31)) {
    const f = parseForecast(r);
    if (f) out.push(f);
  }
  return out;
}

// ── Editable agronomic thresholds (NON-NEGOTIABLE #4: templates, NOT prescriptions). ──────────────
// These defaults are conservative placeholders pending the agronomist + pesticide-registration
// sign-off (Stage 10 / SPEC-0008). They are owner/farm_manager-editable; never presented as authoritative.
export interface WeatherThresholds {
  sprayMaxWindKph: number;
  pollinateMaxRainMm: number;
  pollinateMaxWindKph: number;
  harvestMaxRainMm: number;
  heatStressC: number;
  frostBelowC: number;
}

export const DEFAULT_THRESHOLDS: WeatherThresholds = {
  sprayMaxWindKph: 15,
  pollinateMaxRainMm: 1,
  pollinateMaxWindKph: 20,
  harvestMaxRainMm: 1,
  heatStressC: 45,
  frostBelowC: 2,
};

/**
 * Merge a possibly-partial/malformed stored thresholds blob (e.g. `organization.settings.weather_
 * thresholds`, jsonb) over `base`. Same trust-boundary discipline as `parseForecast`: each field is
 * independently range-checked (`finiteInRange`, the RANGE envelopes above) and a missing/invalid field
 * falls back to its OWN default rather than discarding the whole object — an older shape or one bad
 * field must never silently corrupt every gate.
 */
export function mergeThresholds(
  raw: unknown,
  base: WeatherThresholds = DEFAULT_THRESHOLDS,
): WeatherThresholds {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const pick = (key: keyof WeatherThresholds, lo: number, hi: number): number =>
    finiteInRange(o[key], lo, hi) ?? base[key];
  return {
    sprayMaxWindKph: pick("sprayMaxWindKph", RANGE.windKph[0], RANGE.windKph[1]),
    pollinateMaxRainMm: pick("pollinateMaxRainMm", RANGE.rainMm[0], RANGE.rainMm[1]),
    pollinateMaxWindKph: pick("pollinateMaxWindKph", RANGE.windKph[0], RANGE.windKph[1]),
    harvestMaxRainMm: pick("harvestMaxRainMm", RANGE.rainMm[0], RANGE.rainMm[1]),
    heatStressC: pick("heatStressC", RANGE.tempC[0], RANGE.tempC[1]),
    frostBelowC: pick("frostBelowC", RANGE.tempC[0], RANGE.tempC[1]),
  };
}

export type GateLevel = "ok" | "advise" | "unknown";

export interface OperationGates {
  spray: GateLevel;
  pollinate: GateLevel;
  harvest: GateLevel;
  heatStress: boolean | null; // null = unknown (no forecast)
  frost: boolean | null; // null = unknown (no forecast)
  reasons: Partial<Record<"spray" | "pollinate" | "harvest" | "heat" | "frost", string>>;
}

/**
 * Deterministic operation gating from a forecast + thresholds. ADVISORY by default (SPEC-0007 §5.3):
 * a triggered condition yields "advise" (surface the warning), never a hard block — the responsible
 * human decides. A null forecast (feed outage / parse failure) yields "unknown" for every gate, so a
 * 3rd-party outage NEVER wedges planning (graceful degradation, §2.4).
 */
export function computeGates(
  f: Forecast | null,
  thresholds: WeatherThresholds = DEFAULT_THRESHOLDS,
): OperationGates {
  if (!f) {
    return {
      spray: "unknown",
      pollinate: "unknown",
      harvest: "unknown",
      heatStress: null,
      frost: null,
      reasons: {},
    };
  }
  const reasons: OperationGates["reasons"] = {};

  const sprayWindy = f.windKph > thresholds.sprayMaxWindKph;
  if (sprayWindy) reasons.spray = `الرياح ${Math.round(f.windKph)} كم/س تتجاوز حد الرش`;

  const pollinateBad = f.rainMm > thresholds.pollinateMaxRainMm || f.windKph > thresholds.pollinateMaxWindKph;
  if (pollinateBad)
    reasons.pollinate =
      f.rainMm > thresholds.pollinateMaxRainMm ? `أمطار ${f.rainMm} مم تعيق التلقيح` : `رياح قوية تعيق التلقيح`;

  const harvestWet = f.rainMm > thresholds.harvestMaxRainMm;
  if (harvestWet) reasons.harvest = `أمطار ${f.rainMm} مم — يُفضّل تأجيل الحصاد`;

  const heat = f.tempC >= thresholds.heatStressC;
  if (heat) reasons.heat = `حرارة ${Math.round(f.tempC)}°م — إجهاد حراري محتمل`;

  // Frost gate (canonical orchard risk — date-palm bloom/fruit-set is cold-sensitive). Single-reading
  // check, deliberately NOT a sustained-cold/duration model (keep consistent with the other gates,
  // which are also single-day threshold checks — see module header).
  const frost = f.tempC < thresholds.frostBelowC;
  if (frost) reasons.frost = `⚠️ خطر صقيع — درجة الحرارة المتوقعة ${Math.round(f.tempC)}°م`;

  return {
    spray: sprayWindy ? "advise" : "ok",
    pollinate: pollinateBad ? "advise" : "ok",
    harvest: harvestWet ? "advise" : "ok",
    heatStress: heat,
    frost,
    reasons,
  };
}
