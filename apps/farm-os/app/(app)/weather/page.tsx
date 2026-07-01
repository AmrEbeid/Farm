import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WeatherCard } from "@/components/WeatherCard";
import { getForecast } from "@/lib/weather-server";
import { getOrgWeatherThresholds } from "@/lib/weather-thresholds-server";

/**
 * Weather (Stage 9 / SPEC-0007). Server-side fetch (key never reaches the client), strict-parsed and
 * shown as a forecast + ADVISORY operation gates. Degrades gracefully when the provider key isn't set
 * or the feed is down — planning is never blocked by a 3rd-party outage. Thresholds are the org's saved
 * override (owner/farm_manager-editable at /weather/thresholds), falling back to DEFAULT_THRESHOLDS.
 */
export default async function WeatherPage() {
  const m = await requireMembership();
  const sb = await createClient();
  const [result, thresholds] = await Promise.all([getForecast(), getOrgWeatherThresholds(sb, m.orgId)]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">الطقس وتنبيهات العمليات</h1>
      <WeatherCard result={result} thresholds={thresholds} />
    </div>
  );
}
