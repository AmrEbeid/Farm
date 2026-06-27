import { requireMembership } from "@/lib/auth";
import { WeatherCard } from "@/components/WeatherCard";
import { getForecast } from "@/lib/weather-server";

/**
 * Weather (Stage 9 / SPEC-0007). Server-side fetch (key never reaches the client), strict-parsed and
 * shown as a forecast + ADVISORY operation gates. Degrades gracefully when the provider key isn't set
 * or the feed is down — planning is never blocked by a 3rd-party outage.
 */
export default async function WeatherPage() {
  await requireMembership();
  const result = await getForecast();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">الطقس وتنبيهات العمليات</h1>
      <WeatherCard result={result} />
    </div>
  );
}
