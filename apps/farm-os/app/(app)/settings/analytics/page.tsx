import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { TrendLineChart } from "@/components/charts";
import { num } from "@/lib/money";
import {
  loadWebsiteAnalytics,
  type WebsiteAnalyticsBreakdown,
  type WebsiteAnalyticsPeriod,
} from "@/lib/website-analytics";

const PERIOD_LABELS: Record<WebsiteAnalyticsPeriod, string> = {
  "7d": "آخر 7 أيام",
  "30d": "آخر 30 يومًا",
  "90d": "آخر 90 يومًا",
};

const EVENT_LABELS: Record<string, string> = {
  certificate_opened: "فتح شهادة",
  contact_email: "ضغط البريد الإلكتروني",
  contact_location: "فتح موقع المزرعة",
  contact_phone: "ضغط رقم الهاتف",
  contact_whatsapp: "ضغط واتساب",
  enquiry_submitted: "إرسال طلب سعر",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "كمبيوتر",
  mobile: "هاتف",
  tablet: "جهاز لوحي",
  unknown: "غير محدد",
};

function validPeriod(value: string | undefined): WebsiteAnalyticsPeriod {
  return value === "7d" || value === "90d" ? value : "30d";
}

function countryLabel(code: string): string {
  if (code === "غير محدد") return code;
  try {
    return new Intl.DisplayNames(["ar"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function rowsFor(
  items: WebsiteAnalyticsBreakdown[],
  label: (value: string) => string = (value) => value,
): SimpleRow[] {
  return items.map((item, index) => ({
    id: `${item.label}-${index}`,
    label: label(item.label),
    visitors: num(item.visitors),
    total: num(item.count || item.pageviews || 0),
  }));
}

const breakdownColumns: SimpleColumn[] = [
  { id: "label", header: "التفصيل" },
  { id: "visitors", header: "الزوار", numeric: true },
  { id: "total", header: "المشاهدات / الإجراءات", numeric: true },
];

export default async function WebsiteAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const membership = await requireRole(["owner"]);
  const { period: rawPeriod } = await searchParams;
  const period = validPeriod(rawPeriod);
  const analytics = await loadWebsiteAnalytics(period);
  const sb = await createClient();
  const { count: enquiryCount, error: enquiryError } = await sb
    .from("site_enquiries")
    .select("id", { count: "exact", head: true })
    .eq("org_id", membership.orgId)
    .gte("created_at", analytics.since);
  if (enquiryError) throw enquiryError;

  const actionCount = analytics.events.reduce((sum, event) => sum + (event.count ?? 0), 0);
  const pagesPerVisitor = analytics.visitors > 0 ? analytics.pageviews / analytics.visitors : 0;
  const trend = analytics.trend.map((point) => ({
    date: new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(new Date(point.date)),
    "الزوار": point.visitors,
    "مشاهدات الصفحة": point.pageviews,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">زوار الموقع والتحليلات</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            أداء الصفحة العامة فقط، دون تتبع صفحات النظام أو تخزين بيانات شخصية للزوار.
          </p>
        </div>
        <a
          href="https://ebeidfarm.business"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
          style={{ color: "var(--brand)", background: "var(--surface)", border: "1px solid var(--line)" }}
        >
          فتح الموقع
        </a>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="فترة التحليلات">
        {(Object.keys(PERIOD_LABELS) as WebsiteAnalyticsPeriod[]).map((value) => (
          <Link
            key={value}
            href={`/settings/analytics?period=${value}`}
            aria-current={period === value ? "page" : undefined}
            className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold"
            style={{
              color: period === value ? "var(--surface)" : "var(--brand)",
              background: period === value ? "var(--brand)" : "var(--surface)",
              border: "1px solid var(--line)",
            }}
          >
            {PERIOD_LABELS[value]}
          </Link>
        ))}
      </nav>

      {analytics.status !== "ready" && (
        <div
          role="status"
          className="rounded-md p-4 text-sm font-semibold"
          style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
        >
          {analytics.message}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="الزوار" value={num(analytics.visitors)} />
        <KpiCard label="مشاهدات الصفحة" value={num(analytics.pageviews)} />
        <KpiCard label="مشاهدات لكل زائر" value={num(pagesPerVisitor, 1)} />
        <KpiCard label="إجراءات التواصل" value={num(actionCount)} />
        <KpiCard label="طلبات السعر المحفوظة" value={num(enquiryCount ?? 0)} />
      </section>

      <Card title={`حركة الزيارات · ${PERIOD_LABELS[period]}`}>
        {trend.length > 0 ? (
          <TrendLineChart
            data={trend}
            categoryKey="date"
            series={[
              { dataKey: "الزوار", name: "الزوار" },
              { dataKey: "مشاهدات الصفحة", name: "مشاهدات الصفحة" },
            ]}
            ariaLabel="تطور زوار الموقع ومشاهدات الصفحة يوميًا"
            caption="حركة زيارات الموقع"
            columnHeader="اليوم"
          />
        ) : (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            لا توجد زيارات مسجلة في هذه الفترة بعد.
          </p>
        )}
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <BreakdownCard title="الدول" rows={rowsFor(analytics.countries, countryLabel)} empty="لا توجد بيانات دول بعد" />
        <BreakdownCard
          title="مصادر الزيارة"
          rows={rowsFor(analytics.referrers, (value) => value === "غير محدد" ? "زيارة مباشرة" : value)}
          empty="لا توجد مصادر زيارة بعد"
        />
        <BreakdownCard
          title="الأجهزة"
          rows={rowsFor(analytics.devices, (value) => DEVICE_LABELS[value.toLowerCase()] ?? value)}
          empty="لا توجد بيانات أجهزة بعد"
        />
        <BreakdownCard title="المتصفحات" rows={rowsFor(analytics.browsers)} empty="لا توجد بيانات متصفحات بعد" />
      </section>

      <Card title="التفاعل والتحويل">
        <SimpleTable
          columns={breakdownColumns}
          rows={rowsFor(analytics.events, (value) => EVENT_LABELS[value] ?? value)}
          ariaLabel="إجراءات التفاعل على الموقع"
          empty="ستظهر هنا ضغطات واتساب والبريد والهاتف وفتح الشهادات وطلبات السعر بعد بدء التتبع."
        />
      </Card>
    </div>
  );
}

function BreakdownCard({ title, rows, empty }: { title: string; rows: SimpleRow[]; empty: string }) {
  return (
    <Card title={title}>
      <SimpleTable columns={breakdownColumns} rows={rows} ariaLabel={title} empty={empty} />
    </Card>
  );
}
