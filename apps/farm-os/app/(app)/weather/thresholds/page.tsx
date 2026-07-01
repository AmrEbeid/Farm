import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrgWeatherThresholds } from "@/lib/weather-thresholds-server";
import { WeatherThresholdsForm } from "@/components/WeatherThresholdsForm";

/**
 * Weather thresholds editor (SPEC-0007 §3 "editable thresholds", Stage 9 follow-up). Owner/farm_manager
 * only; the setter (fn_update_weather_thresholds) re-enforces authorize('plan.write', org) server-side.
 */
export default async function WeatherThresholdsPage() {
  const m = await requireRole(["owner", "farm_manager"]);
  const sb = await createClient();
  const thresholds = await getOrgWeatherThresholds(sb, m.orgId);

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-bold">عتبات الطقس</h1>
      <WeatherThresholdsForm thresholds={thresholds} />
    </div>
  );
}
