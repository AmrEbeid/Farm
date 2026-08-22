import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard, Tag } from "@/components/ui";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { CategoryBarChart, MultiInsightChart, TrendLineChart } from "@/components/charts";
import { num } from "@/lib/money";
import { compareDecimals, decimalToSafeNumber, egpExact, type DecimalString } from "@/lib/decimal";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import {
  buildCostCenterYearMatrix,
  buildCostCenterYearTrend,
  costCenterDescendantIds,
  parseCostCenterReportView,
  topmostVisibleCostCenters,
  type CostCenterReportView,
} from "@/lib/cost-center-report";
import {
  parseCostCenterReportsSnapshot,
  type CostCenterSnapshotRow,
} from "@/lib/cost-center-reports-snapshot";

type Focus = "all" | "posted" | "flags";

const FLAG_LABEL_AR: Record<string, string> = {
  missing_sector_link: "بلا ربط قطاع",
  area_mismatch: "اختلاف مساحة",
};

export default async function FinanceReportsPage({ searchParams }: { searchParams: Promise<{ center?: string; focus?: string; view?: string }> }) {
  const { center, focus: requestedFocus, view: requestedView } = await searchParams;
  const focus = parseFocus(requestedFocus);
  const view = parseCostCenterReportView(requestedView);
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const snapshotRes = await sb.rpc("fn_cost_center_reports_snapshot", {
    p_org: m.orgId,
    p_include_history: view === "history",
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseCostCenterReportsSnapshot(snapshotRes.data, m.orgId, view === "history");
  const { rollup, flags, history: historyRows, expenseTotal, revenueTotal, profit } = snapshot;
  const centerById = new Map(rollup.map((row) => [row.costCenterId, row]));
  const centerByCode = new Map(rollup.map((row) => [row.code, row]));
  const flaggedIds = new Set(flags.map((flag) => flag.costCenterId));
  const hasPosted = new Set(
    rollup
      .filter((row) => row.lineCount > 0)
      .map((row) => row.costCenterId),
  );
  const selectedCenter = center ? centerByCode.get(center) : undefined;
  if (center && !selectedCenter) notFound();
  const visibleRollup = rollup.filter((row) => {
    if (selectedCenter) return row.costCenterId === selectedCenter.costCenterId;
    if (focus === "posted") return hasPosted.has(row.costCenterId);
    if (focus === "flags") return flaggedIds.has(row.costCenterId);
    return true;
  });
  const visibleIds = new Set(visibleRollup.map((row) => row.costCenterId));
  const historyIds = new Set<string>();
  for (const row of visibleRollup) {
    for (const id of costCenterDescendantIds(rollup, row.costCenterId)) historyIds.add(id);
  }
  const visibleFlags = flags.filter((flag) => visibleIds.has(flag.costCenterId));
  const visibleHistoryRows = historyRows.filter((row) => historyIds.has(row.costCenterId));

  const unallocatedLines = snapshot.unallocatedLineCount;

  const rollupRows = visibleRollup.map((row) => {
    const parent = row.parentId ? centerById.get(row.parentId) : null;
    const flagged = flaggedIds.has(row.costCenterId);
    return {
      id: row.costCenterId,
      code: row.code,
      center: row.nameAr,
      center_href: `/finance/cost-centers/${row.costCenterId}`,
      parent: parent ? parent.nameAr : "جذر",
      enterprise: row.enterprise ?? "غير متوفر",
      area: row.areaFeddan ?? undefined,
      expense: row.expense,
      revenue: row.revenue,
      net: row.net,
      netPerFeddan: row.netPerFeddan ?? undefined,
      status: row.active ? (flagged ? "مراجعة" : "نشط") : "مؤرشف",
    };
  });

  const matrix = buildCostCenterYearMatrix(visibleHistoryRows);
  const centerCharts = buildCenterChartData(visibleRollup, rollup);
  const trendChart = safeHistoryTrend(visibleHistoryRows);
  const displayExpense = selectedCenter?.expense ?? expenseTotal;
  const displayRevenue = selectedCenter?.revenue ?? revenueTotal;
  const displayProfit = selectedCenter?.net ?? profit;
  const subjectLabel = selectedCenter?.nameAr ?? "المزرعة";

  // U-12 (§2c): the all-time ledger story in one sentence, from the trusted posted-only trial balance.
  const costLead =
    (selectedCenter?.lineCount ?? [...hasPosted].length) > 0
      ? `سجل ${subjectLabel} مصروفات ${egpExact(displayExpense)} مقابل إيرادات ${egpExact(displayRevenue)} — ${compareDecimals(displayProfit, "0") >= 0 ? "فائض" : "عجز"} ${egpExact(absDecimal(displayProfit))} في الدفاتر.`
      : "لا قيود مصروفات أو إيرادات مرحّلة في الدفاتر بعد.";
  const costNotes: string[] = [];
  if (unallocatedLines > 0) {
    costNotes.push(`⚠ ${num(unallocatedLines)} قيد غير موزَّع على مركز تكلفة — وزّعها لتكتمل صورة «أين تذهب الفلوس».`);
  }
  if (hasUnsafeChartMoney(visibleRollup, rollup) || (view === "history" && visibleHistoryRows.length > 0 && trendChart.length === 0)) {
    costNotes.push("الرسم مخفي لأن قيمة دقيقة لا يمكن تحويلها بأمان إلى مكتبة الرسوم؛ الجداول والإجماليات ما زالت كاملة ودقيقة.");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">تقارير مراكز التكلفة</h1>
          <p style={{ color: "var(--ink-muted)" }}>مصروفات وإيرادات كل مركز تكلفة من القيود المرحّلة فقط؛ غير الموزع يظهر صراحة ولا يتم تخمينه.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton label="طباعة التقرير" />
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
          <HeaderLink href="/finance/accounts">شجرة الحسابات</HeaderLink>
          <HeaderLink href="/accounting">المحاسبة</HeaderLink>
        </div>
      </header>

      <nav aria-label="نطاق تقرير مراكز التكلفة" className="flex w-fit overflow-hidden rounded-md" style={{ border: "1px solid var(--line)" }}>
        <ReportViewLink href={reportHref({ view: "overview", focus, center })} active={view === "overview"}>
          ملخص سريع
        </ReportViewLink>
        <ReportViewLink href={reportHref({ view: "history", focus, center })} active={view === "history"}>
          التحليل السنوي
        </ReportViewLink>
      </nav>

      <StoryLine lead={costLead} notes={costNotes} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardKpiLink href={reportHref({ view })} active={!center && focus === "all"}>
          <KpiCard label="مراكز التكلفة" value={num(rollup.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href={reportHref({ view, focus: "posted" })} active={!center && focus === "posted"}>
          <KpiCard label="لها قيود" value={num(hasPosted.size)} />
        </DashboardKpiLink>
        <DashboardKpiLink href={reportHref({ view, center: "CC-UNALLOC" })} active={center === "CC-UNALLOC"}>
          <KpiCard
            label="سطور غير موزّعة"
            value={num(unallocatedLines)}
            deltaDirection={unallocatedLines > 0 ? "down" : "none"}
          />
        </DashboardKpiLink>
        <DashboardKpiLink href={reportHref({ view, focus: "flags" })} active={!center && focus === "flags"}>
          <KpiCard label="بنود مراجعة" value={num(flags.length)} deltaDirection={flags.length > 0 ? "down" : "none"} />
        </DashboardKpiLink>
        <KpiCard label="صافي التشغيل" value={egpExact(displayProfit)} deltaDirection={compareDecimals(displayProfit, "0") < 0 ? "down" : "none"} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <KpiCard label="مصروفات" value={egpExact(displayExpense)} />
        <KpiCard label="إيرادات" value={egpExact(displayRevenue)} />
      </section>

      {(selectedCenter || focus !== "all") && (
        <Card title="الفلتر الحالي">
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="warning">
              {selectedCenter ? `${selectedCenter.code} · ${selectedCenter.nameAr}` : focus === "posted" ? "مراكز لها قيود" : "بنود تحتاج مراجعة"}
            </Tag>
            <HeaderLink href={reportHref({ view })}>كل التقرير</HeaderLink>
          </div>
        </Card>
      )}

      {(centerCharts.length > 0 || trendChart.length > 0) && (
        <section className="grid gap-4 xl:grid-cols-2">
          <Card title="رؤية متعددة">
            <MultiInsightChart
              ariaLabel="اختيار زاوية التحليل"
              options={[
                {
                  id: "center",
                  label: "حسب المركز",
                  render: () =>
                    centerCharts.length > 0 ? (
                      <CategoryBarChart
                        data={centerCharts}
                        categoryKey="center"
                        series={[
                          { dataKey: "مصروفات", name: "مصروفات" },
                          { dataKey: "إيرادات", name: "إيرادات" },
                        ]}
                        ariaLabel="مصروفات وإيرادات حسب مركز التكلفة"
                        caption="حسب المركز"
                        columnHeader="المركز"
                      />
                    ) : (
                      <EmptyState title="لا توجد قيود موزعة على مراكز بعد" />
                    ),
                },
                ...(view === "history"
                  ? [
                      {
                        id: "year",
                        label: "حسب السنة",
                        render: () =>
                          trendChart.length > 0 ? (
                            <TrendLineChart
                              data={trendChart}
                              categoryKey="year"
                              series={[{ dataKey: "مصروفات", name: "مصروفات" }]}
                              overlaySeries={[
                                { dataKey: "إيرادات", name: "إيرادات" },
                                { dataKey: "صافي", name: "صافي" },
                              ]}
                              ariaLabel="اتجاه مصروفات وإيرادات مراكز التكلفة حسب السنة"
                              caption="حسب السنة"
                              columnHeader="السنة"
                            />
                          ) : (
                            <EmptyState title="لا توجد قيود مؤرخة بعد" />
                          ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>

        </section>
      )}

      <Card title="إشارات المراجعة">
        {visibleFlags.length ? (
          <FilterableTable
            columns={flagColumns}
            rows={visibleFlags.map((flag) => ({
              id: `${flag.costCenterId}-${flag.flagCode}`,
              code: flag.code,
              center: flag.nameAr,
              flag: FLAG_LABEL_AR[flag.flagCode] ?? flag.flagCode,
              message: flag.messageAr,
            }))}
            ariaLabel="إشارات مراجعة مراكز التكلفة"
            exportFilename="cost center reconciliation flags.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد إشارات مراجعة" />
        )}
      </Card>

      <Card title="اقتصاديات مراكز التكلفة">
        {rollupRows.length ? (
          <FilterableTable
            columns={rollupColumns}
            rows={rollupRows}
            ariaLabel="اقتصاديات مراكز التكلفة"
            exportFilename="cost center rollup.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد مراكز مطابقة للفلتر" />
        )}
      </Card>

      {view === "history" && (
        <Card title="المصفوفة: الحساب × السنة × المركز">
          {matrix.rows.length ? (
            <FilterableTable
              columns={matrix.columns}
              rows={matrix.rows}
              ariaLabel="مصفوفة الحساب والسنة ومركز التكلفة"
              exportFilename="cost center year matrix.csv"
              minRowsForSearch={1}
            />
          ) : (
            <EmptyState title="لا توجد قيود مصروفات أو إيرادات بعد" />
          )}
        </Card>
      )}
    </div>
  );
}

const rollupColumns: SimpleColumn[] = [
  { id: "code", header: "الكود", kind: "code" },
  { id: "center", header: "المركز", kind: "link" },
  { id: "parent", header: "الأصل" },
  { id: "enterprise", header: "النشاط" },
  { id: "area", header: "فدان", kind: "decimal-exact", numeric: true, decimal: true },
  { id: "expense", header: "مصروفات", kind: "money-exact", numeric: true, decimal: true },
  { id: "revenue", header: "إيرادات", kind: "money-exact", numeric: true, decimal: true },
  { id: "net", header: "صافي (إيراد - مصروف)", kind: "money-exact", numeric: true, decimal: true },
  { id: "netPerFeddan", header: "صافي الربح/فدان", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "status", header: "الحالة", kind: "status" },
];

const flagColumns: SimpleColumn[] = [
  { id: "code", header: "الكود", kind: "code" },
  { id: "center", header: "المركز" },
  { id: "flag", header: "الإشارة", kind: "status" },
  { id: "message", header: "التفاصيل" },
];

function buildCenterChartData(
  rollup: CostCenterSnapshotRow[],
  hierarchyRows: CostCenterSnapshotRow[],
): Array<Record<string, string | number>> {
  const candidates = topmostVisibleCostCenters(rollup, hierarchyRows)
    .filter((row) => row.lineCount > 0)
    .map((row) => ({
      row,
      expense: decimalToSafeNumber(row.expense),
      revenue: decimalToSafeNumber(row.revenue),
      net: decimalToSafeNumber(row.net),
    }));
  if (candidates.some((candidate) => candidate.expense == null || candidate.revenue == null || candidate.net == null)) {
    return [];
  }
  return candidates
    .sort((a, b) => Math.abs(b.net!) - Math.abs(a.net!))
    .slice(0, 8)
    .map(({ row, expense, revenue }) => ({
      center: row.nameAr,
      مصروفات: expense!,
      إيرادات: revenue!,
    }));
}

function hasUnsafeChartMoney(rollup: CostCenterSnapshotRow[], hierarchyRows: CostCenterSnapshotRow[]): boolean {
  return topmostVisibleCostCenters(rollup, hierarchyRows)
    .filter((row) => row.lineCount > 0)
    .some((row) => decimalToSafeNumber(row.expense) == null || decimalToSafeNumber(row.revenue) == null || decimalToSafeNumber(row.net) == null);
}

function safeHistoryTrend(historyRows: Parameters<typeof buildCostCenterYearTrend>[0]) {
  try {
    return buildCostCenterYearTrend(historyRows);
  } catch (error) {
    if (error instanceof Error && error.message.includes("exceeds safe display range")) return [];
    throw error;
  }
}

function absDecimal(value: DecimalString): DecimalString {
  return value.startsWith("-") ? value.slice(1) : value;
}

function parseFocus(value: string | undefined): Focus {
  return value === "posted" || value === "flags" ? value : "all";
}

function reportHref({ view, focus = "all", center }: { view: CostCenterReportView; focus?: Focus; center?: string }): string {
  const params = new URLSearchParams();
  if (view === "history") params.set("view", "history");
  if (focus !== "all") params.set("focus", focus);
  if (center) params.set("center", center);
  const query = params.toString();
  return query ? `/finance/reports?${query}` : "/finance/reports";
}

function ReportViewLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="inline-flex min-h-9 items-center justify-center px-4 text-sm font-semibold"
      style={{
        color: active ? "white" : "var(--brand)",
        background: active ? "var(--brand)" : "var(--surface)",
      }}
    >
      {children}
    </Link>
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
