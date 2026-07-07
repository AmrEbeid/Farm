import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard, Tag } from "@/components/ui";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { CategoryBarChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { buildFinanceInsightSummary, type CostCenterInsightFlag, type CostCenterInsightRollup } from "@/lib/finance-insights";
import { egp, num } from "@/lib/money";

export default async function FinanceInsightsPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const [rollupRes, flagsRes] = await Promise.all([
    sb.from("v_cost_center_rollup").select("*").eq("org_id", m.orgId).order("sort_order", { ascending: true }),
    sb.from("v_cost_center_reconciliation_flags").select("*").eq("org_id", m.orgId).order("code", { ascending: true }),
  ]);
  if (rollupRes.error) throw rollupRes.error;
  if (flagsRes.error) throw flagsRes.error;

  const summary = buildFinanceInsightSummary({
    rollup: (rollupRes.data ?? []) as CostCenterInsightRollup[],
    flags: (flagsRes.data ?? []) as CostCenterInsightFlag[],
  });
  const chartRows = summary.topExpenseCenters.map((row) => ({
    center: row.name,
    "مصروفات": row.expense,
    "إيرادات": row.revenue,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">رؤى المالك المالية</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            قراءة آلية من القيود ومراكز التكلفة الحالية، بدون أرقام مقدّرة أو ذكاء اصطناعي.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة الرؤى" />
          <HeaderLink href="/dashboard/owner">لوحة المالك</HeaderLink>
          <HeaderLink href="/finance/reports">تقارير التكلفة</HeaderLink>
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="التقييم" value={summary.score.label} />
        <DashboardKpiLink href="/finance/reports?focus=posted" active={false}>
          <KpiCard label="مراكز لها قيود" value={num(summary.postedCenterCount)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/reports?center=CC-UNALLOC" active={false}>
          <KpiCard label="مصروفات غير موزّعة" value={egp(summary.unallocatedCost)} deltaDirection={Math.abs(summary.unallocatedCost) > 0 ? "down" : "none"} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/reports?focus=flags" active={false}>
          <KpiCard label="بنود مراجعة" value={num(summary.flagCount)} deltaDirection={summary.flagCount > 0 ? "down" : "none"} />
        </DashboardKpiLink>
        <KpiCard label="صافي التشغيل" value={egp(summary.operatingNet)} deltaDirection={summary.operatingNet < 0 ? "down" : "none"} />
      </section>

      <Card title="بطاقة التقييم">
        <div className="flex flex-wrap items-center gap-3">
          <Tag tone={summary.score.tone}>{summary.score.label}</Tag>
          <p style={{ color: "var(--ink-muted)" }}>{summary.score.message}</p>
        </div>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="بطاقات الرؤى">
          {summary.cards.length ? (
            <div className="grid gap-3">
              {summary.cards.map((card) => (
                <Link key={card.id} href={card.href} className="block rounded-md border p-3 transition-opacity hover:opacity-90" style={{ borderColor: "var(--line)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={card.tone}>{card.title}</Tag>
                    <strong>{card.value}</strong>
                  </div>
                  <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>{card.description}</p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="لا توجد رؤى مالية بعد" />
          )}
        </Card>

        <Card title="أعلى مراكز التكلفة">
          {chartRows.length ? (
            <CategoryBarChart
              data={chartRows}
              categoryKey="center"
              series={[
                { dataKey: "مصروفات", name: "مصروفات" },
                { dataKey: "إيرادات", name: "إيرادات" },
              ]}
              ariaLabel="أعلى مراكز التكلفة حسب المصروفات"
              caption="أعلى مراكز التكلفة"
              columnHeader="المركز"
            />
          ) : (
            <EmptyState title="لا توجد قيود موزعة على مراكز بعد" />
          )}
        </Card>
      </section>

      <Card title="جدول الرؤى حسب المركز">
        {summary.centerRows.length ? (
          <FilterableTable
            columns={centerColumns}
            rows={summary.centerRows.map((row) => ({
              id: row.id,
              code: row.code,
              center: row.name,
              enterprise: row.enterprise,
              area: row.areaFeddan ?? undefined,
              expense: row.expense,
              revenue: row.revenue,
              net: row.net,
              netPerFeddan: row.netPerFeddan ?? undefined,
            }))}
            ariaLabel="جدول رؤى مراكز التكلفة"
            exportFilename="owner finance insights.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد مراكز تكلفة نشطة" />
        )}
      </Card>
    </div>
  );
}

const centerColumns: SimpleColumn[] = [
  { id: "code", header: "الكود", kind: "code" },
  { id: "center", header: "المركز" },
  { id: "enterprise", header: "النشاط" },
  { id: "area", header: "فدان", kind: "num", numeric: true },
  { id: "expense", header: "مصروفات", kind: "money", numeric: true },
  { id: "revenue", header: "إيرادات", kind: "money", numeric: true },
  { id: "net", header: "مصروف - إيراد", kind: "money", numeric: true },
  { id: "netPerFeddan", header: "صافي/فدان", kind: "money", numeric: true },
];

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
