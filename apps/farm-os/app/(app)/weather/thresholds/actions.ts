"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { RANGE, type WeatherThresholds } from "@/lib/weather";

type Result = { ok: boolean; error?: string };

function inRange(v: number, [lo, hi]: readonly [number, number]): boolean {
  return Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * Save the org's weather-gate thresholds (SPEC-0007 §3). App-level check here is defense-in-depth
 * only — `fn_update_weather_thresholds` re-enforces `authorize('plan.write', org)` (owner/farm_manager)
 * and re-validates every field server-side; this action can never be the only gate.
 */
export async function updateWeatherThresholds(input: WeatherThresholds): Promise<Result> {
  if (
    !inRange(input.sprayMaxWindKph, RANGE.windKph) ||
    !inRange(input.pollinateMaxWindKph, RANGE.windKph)
  ) {
    return { ok: false, error: "قيمة الرياح غير صالحة" };
  }
  if (
    !inRange(input.pollinateMaxRainMm, RANGE.rainMm) ||
    !inRange(input.harvestMaxRainMm, RANGE.rainMm)
  ) {
    return { ok: false, error: "قيمة الأمطار غير صالحة" };
  }
  if (!inRange(input.heatStressC, RANGE.tempC) || !inRange(input.frostBelowC, RANGE.tempC)) {
    return { ok: false, error: "قيمة درجة الحرارة غير صالحة" };
  }
  if (input.frostBelowC >= input.heatStressC) {
    return { ok: false, error: "حد الصقيع يجب أن يكون أقل من حد الإجهاد الحراري" };
  }

  const m = await requireRole(["owner", "farm_manager"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_update_weather_thresholds", {
    p_org: m.orgId,
    p_thresholds: input,
  });
  if (error) return { ok: false, error: toArabicError(error, {}, "تعذّر حفظ عتبات الطقس") };

  revalidatePath("/weather/thresholds");
  revalidatePath("/weather");
  revalidatePath("/weather/dashboard");
  return { ok: true };
}
