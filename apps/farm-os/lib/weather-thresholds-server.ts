import "server-only";

// Server-side read of the org's saved weather-gate thresholds (SPEC-0007 §3: "thresholds owner/
// farm_manager-writable via authorize('plan.write')"). Stored in the pre-existing, previously-unused
// `organization.settings` jsonb column under the `weather_thresholds` key — no new table (the column
// has been on `organization` since migration 0001, see the extensible-settings note in the write-path
// migration). Read via the normal RLS-scoped session client (org membership already gates `organization`
// SELECT), never the service-role key. Falls back to DEFAULT_THRESHOLDS per-field when nothing is saved
// yet, so a brand-new org (or a stale/partial save) still renders correctly — see mergeThresholds.
//
// Writes go through the gated `fn_update_weather_thresholds` RPC only (app/(app)/weather/thresholds/
// actions.ts) — this module is READ-ONLY.

import type { createClient } from "@/lib/supabase/server";
import { mergeThresholds, type WeatherThresholds } from "./weather";

export async function getOrgWeatherThresholds(
  sb: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<WeatherThresholds> {
  const { data, error } = await sb.from("organization").select("settings").eq("id", orgId).maybeSingle();
  // A6: a transient read error must NOT silently degrade to DEFAULT thresholds — that could evaluate a
  // weather gate against the wrong config while looking normal. Surface it to the caller's error
  // boundary. A genuine null (new/unsaved org) still falls back to defaults below, as before.
  if (error) throw error;
  const raw: unknown = data?.settings;
  const settings = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  return mergeThresholds(settings?.["weather_thresholds"]);
}
