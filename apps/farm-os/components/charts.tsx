"use client";

// Client-only chart wrappers. @amrebeid/ui's BarChart/LineChart are Recharts
// based; Recharts is server-stubbed (see next.config.ts / recharts-stub.ts), so
// charts MUST render inside a "use client" boundary to use the real library.
// Import from the dedicated recharts-only subpath so recharts enters only the
// bundles of routes that actually render a chart, never the global chunk.
import { LineChart, BarChart, DoughnutChart } from "@amrebeid/ui/charts";
import { num } from "@/lib/money";

/**
 * Projected Available Balance over the planning horizon. The first period that
 * crosses zero is the projected stock-out. Series is the PAB array from
 * fn_stock_coverage (index 0 = opening, 1..n = weekly balance).
 */
export function PabChart({
  series,
  firstShortage,
}: {
  series: number[];
  firstShortage: number | null;
}) {
  const data = series.map((value, i) => ({
    period: i === 0 ? "الآن" : `أسبوع ${num(i)}`,
    "الرصيد المتوقع": value,
  }));
  return (
    <div>
      <LineChart
        data={data}
        categoryKey="period"
        series={[{ dataKey: "الرصيد المتوقع", name: "الرصيد المتوقع (كجم)" }]}
        ariaLabel="الرصيد المتوقع للمخزون عبر الأسابيع"
        curve="monotone"
        showDots
        height={260}
        tableFallback={{ caption: "الرصيد المتوقع", columnHeader: "الفترة" }}
      />
      {firstShortage != null && (
        <p className="mt-2 text-sm" style={{ color: "var(--danger, #b91c1c)" }}>
          أول نقص متوقع في الأسبوع {num(firstShortage)} (يهبط الرصيد دون الصفر).
        </p>
      )}
    </div>
  );
}

/**
 * Planned vs Actual variance bar chart. Two series per metric category.
 */
export function VarianceChart({
  data,
}: {
  data: Array<{ category: string; planned: number; actual: number }>;
}) {
  return (
    <BarChart
      data={data.map((d) => ({
        category: d.category,
        "المخطط": d.planned,
        "الفعلي": d.actual,
      }))}
      categoryKey="category"
      series={[
        { dataKey: "المخطط", name: "المخطط" },
        { dataKey: "الفعلي", name: "الفعلي" },
      ]}
      ariaLabel="المخطط مقابل الفعلي"
      showLegend
      height={260}
      tableFallback={{ caption: "المخطط مقابل الفعلي", columnHeader: "البند" }}
    />
  );
}

/** Budget utilisation as a part-to-whole snapshot: used vs available. */
export function BudgetDoughnut({ used, available }: { used: number; available: number }) {
  return (
    <DoughnutChart
      data={[
        { name: "المستخدم", value: Math.max(0, used) },
        { name: "المتاح", value: Math.max(0, available) },
      ]}
      ariaLabel="توزيع الموازنة بين المستخدم والمتاح"
      height={240}
      tableFallback={{ caption: "استخدام الموازنة", labelHeader: "البند", valueHeader: "ج.م" }}
    />
  );
}

/** Palm-health mix: count of assets per status (a part-to-whole snapshot). */
export function PalmStatusDoughnut({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <DoughnutChart
      data={data}
      ariaLabel="توزيع حالة النخيل"
      height={240}
      tableFallback={{ caption: "حالة النخيل", labelHeader: "الحالة", valueHeader: "العدد" }}
    />
  );
}

/**
 * Generic part-to-whole doughnut for status / type distributions (e.g. items by
 * stock status, operations by status, team by employment type).
 */
export function CategoryDoughnut({
  data,
  ariaLabel,
  caption,
  labelHeader = "البند",
  valueHeader = "العدد",
}: {
  data: Array<{ name: string; value: number }>;
  ariaLabel: string;
  caption: string;
  labelHeader?: string;
  valueHeader?: string;
}) {
  return (
    <DoughnutChart
      data={data}
      ariaLabel={ariaLabel}
      height={240}
      tableFallback={{ caption, labelHeader, valueHeader }}
    />
  );
}

/** Generic category bar chart (single or grouped series). */
export function CategoryBarChart({
  data,
  categoryKey,
  series,
  ariaLabel,
  caption,
  columnHeader,
}: {
  data: Array<Record<string, string | number>>;
  categoryKey: string;
  series: Array<{ dataKey: string; name: string }>;
  ariaLabel: string;
  caption: string;
  columnHeader: string;
}) {
  return (
    <BarChart
      data={data}
      categoryKey={categoryKey}
      series={series}
      ariaLabel={ariaLabel}
      showLegend={series.length > 1}
      height={260}
      tableFallback={{ caption, columnHeader }}
    />
  );
}

/** Generic multi-series trend line chart (e.g. weather metrics across days). */
export function TrendLineChart({
  data,
  categoryKey,
  series,
  ariaLabel,
  caption,
  columnHeader,
}: {
  data: Array<Record<string, string | number>>;
  categoryKey: string;
  series: Array<{ dataKey: string; name: string }>;
  ariaLabel: string;
  caption: string;
  columnHeader: string;
}) {
  return (
    <LineChart
      data={data}
      categoryKey={categoryKey}
      series={series}
      ariaLabel={ariaLabel}
      curve="monotone"
      showDots
      showLegend={series.length > 1}
      height={260}
      tableFallback={{ caption, columnHeader }}
    />
  );
}
