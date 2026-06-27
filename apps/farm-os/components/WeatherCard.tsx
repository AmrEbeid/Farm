import { Card, Alert, EmptyState } from "@/components/ui";
import {
  computeGates,
  type Forecast,
  type WeatherThresholds,
  type OperationGates,
} from "@/lib/weather";

const OP_AR: Record<keyof OperationGates["reasons"], string> = {
  spray: "الرش",
  pollinate: "التلقيح",
  harvest: "الحصاد",
  heat: "إجهاد حراري",
};

function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Weather forecast + ADVISORY operation gates (Stage 9). Server-renderable, RTL. Shows a clear
 * "not configured" state when the Owner hasn't set the provider key (SPEC §5.1), and a standing note
 * that the thresholds are agronomic templates pending sign-off (non-negotiable #4 / Stage 10).
 */
export function WeatherCard({
  result,
  thresholds,
}: {
  result: { configured: boolean; forecasts: Forecast[]; error?: string };
  thresholds?: WeatherThresholds;
}) {
  if (!result.configured) {
    return (
      <Card title="الطقس">
        <Alert
          tone="info"
          title="خدمة الطقس غير مُفعّلة"
          description="لتفعيل توقعات الطقس وتنبيهات العمليات، يضبط المالك مفتاح مزوّد الطقس (WEATHER_API_KEY) ورابطه (WEATHER_API_URL) في إعدادات الخادم."
        />
      </Card>
    );
  }
  if (result.forecasts.length === 0) {
    return (
      <Card title="الطقس">
        <Alert tone="warning" title="تعذّر جلب التوقعات حاليًا" description="التخطيط مستمر؛ تنبيهات الطقس غير متاحة مؤقتًا (تظهر كـ«غير معروف»)." />
      </Card>
    );
  }

  return (
    <Card title="الطقس وتنبيهات العمليات">
      <div className="flex flex-col gap-4">
        <Alert
          tone="info"
          title="تنبيهات استرشادية فقط"
          description="عتبات الطقس (رياح/مطر/حرارة) قوالب زراعية قابلة للتعديل وبانتظار اعتماد المهندس الزراعي — القرار النهائي للمسؤول."
        />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.forecasts.slice(0, 6).map((f) => {
            const g = computeGates(f, thresholds);
            const advisories = (Object.keys(g.reasons) as (keyof OperationGates["reasons"])[]).map((k) => ({
              op: OP_AR[k],
              reason: g.reasons[k]!,
            }));
            return (
              <li key={f.date} className="rounded-lg border border-[var(--line,#e5e7eb)] p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-bold">{fmtDay(f.date)}</span>
                  <span className="text-sm tabular-nums">{Math.round(f.tempC)}°م</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-75">
                  <span>💨 {Math.round(f.windKph)} كم/س</span>
                  <span>🌧️ {f.rainMm} مم</span>
                  <span>💧 {f.humidityPct}%</span>
                </div>
                {advisories.length === 0 ? (
                  <span className="text-xs text-[var(--success-fg,#16a34a)]">الظروف مناسبة</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {advisories.map((a) => (
                      <li key={a.op} className="flex items-start gap-1.5 text-xs">
                        <span className="mt-0.5 inline-block h-2 w-2 flex-none rounded-full bg-[var(--warning-fg,#d97706)]" />
                        <span>
                          <b>{a.op}:</b> {a.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {result.forecasts.length === 0 && <EmptyState title="لا توجد توقعات" />}
      </div>
    </Card>
  );
}
