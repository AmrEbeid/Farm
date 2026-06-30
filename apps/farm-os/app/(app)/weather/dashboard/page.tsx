import type { ReactNode } from "react";
import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { TrendLineChart } from "@/components/charts";
import { getForecast } from "@/lib/weather-server";
import { computeGates } from "@/lib/weather";
import { num } from "@/lib/money";

const GATE_AR: Record<"ok" | "advise" | "unknown", string> = {
  ok: "مناسب",
  advise: "تحذير",
  unknown: "غير معروف",
};

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short" });
}

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل الأيام",
  forecast: "نافذة المخاطر",
  advisory: "أيام بها تنبيه",
  heat: "إجهاد حراري",
};

export default async function WeatherDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "all" } = await searchParams;
  await requireMembership();
  const result = await getForecast();
  const forecasts = result.forecasts;
  const rowsWithGates = forecasts.map((forecast) => ({
    forecast,
    gates: computeGates(forecast),
  }));
  const advisoryDays = rowsWithGates.filter(({ gates }) => Object.keys(gates.reasons).length > 0).length;
  const heatDays = rowsWithGates.filter(({ gates }) => gates.heatStress).length;
  const serviceState = !result.configured ? "غير مفعّلة" : result.error ? "تعذّر الجلب" : forecasts.length ? "مفعّلة" : "لا توجد بيانات";

  const gateColumns: SimpleColumn[] = [
    { id: "day", header: "اليوم" },
    { id: "temp", header: "الحرارة" },
    { id: "wind", header: "الرياح" },
    { id: "rain", header: "الأمطار" },
    { id: "spray", header: "الرش", kind: "status" },
    { id: "pollinate", header: "التلقيح", kind: "status" },
    { id: "harvest", header: "الحصاد", kind: "status" },
  ];
  const filteredRowsWithGates = rowsWithGates.filter(({ gates }) => {
    if (filter === "advisory") return Object.keys(gates.reasons).length > 0;
    if (filter === "heat") return gates.heatStress;
    return true;
  });
  const gateRows = filteredRowsWithGates.slice(0, 7).map(({ forecast, gates }) => ({
    id: forecast.date,
    day: fmtDay(forecast.date),
    temp: `${num(Math.round(forecast.tempC))}°م`,
    wind: `${num(Math.round(forecast.windKph))} كم/س`,
    rain: `${num(forecast.rainMm)} مم`,
    spray: GATE_AR[gates.spray],
    pollinate: GATE_AR[gates.pollinate],
    harvest: GATE_AR[gates.harvest],
  }));

  // Chart data — temperature across the forecast horizon (from the same forecast).
  const tempTrend = forecasts.slice(0, 10).map((forecast) => ({
    day: fmtDay(forecast.date),
    "الحرارة": Math.round(forecast.tempC),
  }));

  const reasonColumns: SimpleColumn[] = [
    { id: "day", header: "اليوم" },
    { id: "reason", header: "سبب التنبيه" },
  ];
  const reasonRows = filteredRowsWithGates.flatMap(({ forecast, gates }) =>
    Object.entries(gates.reasons).map(([key, reason]) => ({
      id: `${forecast.date}-${key}`,
      day: fmtDay(forecast.date),
      reason: reason ?? "—",
    })),
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة الطقس والمخاطر</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            تلخيص تنبيهات الطقس الاسترشادية قبل التخطيط والتنفيذ الميداني.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/weather">التوقعات التفصيلية</HeaderLink>
          <HeaderLink href="/plans/dashboard">لوحة التخطيط</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink href="/weather/dashboard?filter=forecast" active={filter === "forecast"}>
          <KpiCard label="أيام التوقعات" value={num(forecasts.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/weather/dashboard?filter=advisory" active={filter === "advisory"}>
          <KpiCard label="أيام بها تنبيه" value={num(advisoryDays)} deltaDirection={advisoryDays ? "down" : "none"} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/weather/dashboard?filter=heat" active={filter === "heat"}>
          <KpiCard label="إجهاد حراري" value={num(heatDays)} deltaDirection={heatDays ? "down" : "none"} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/weather" active={false}>
          <KpiCard label="حالة الخدمة" value={serviceState} />
        </DashboardKpiLink>
      </section>

      <CurrentFilterCard
        label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
        clearHref="/weather/dashboard"
        showClear={filter !== "all"}
      />

      {tempTrend.length > 0 && (
        <Card title="اتجاه درجة الحرارة">
          <TrendLineChart
            data={tempTrend}
            categoryKey="day"
            series={[{ dataKey: "الحرارة", name: "الحرارة (°م)" }]}
            ariaLabel="اتجاه درجة الحرارة عبر أيام التوقعات"
            caption="اتجاه درجة الحرارة"
            columnHeader="اليوم"
          />
        </Card>
      )}

      <Card title="نافذة المخاطر حسب اليوم">
        {gateRows.length === 0 ? (
          <EmptyState title={result.configured ? "لا توجد توقعات متاحة" : "خدمة الطقس غير مفعّلة"} />
        ) : (
          <SimpleTable columns={gateColumns} rows={gateRows} ariaLabel="نافذة المخاطر حسب اليوم" empty="—" />
        )}
      </Card>

      <Card title="أسباب التنبيهات">
        {reasonRows.length === 0 ? (
          <EmptyState title="لا توجد تنبيهات طقس" />
        ) : (
          <SimpleTable columns={reasonColumns} rows={reasonRows} ariaLabel="أسباب التنبيهات" empty="—" />
        )}
      </Card>
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
