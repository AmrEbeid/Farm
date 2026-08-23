import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleAlert, Landmark, ReceiptText, Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { EmptyState, StatusPill } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { CategoryBarChart, MultiInsightChart, TrendLineChart } from "@/components/charts";
import { PageHeader } from "@/components/PageHeader";
import { num } from "@/lib/money";
import { compareDecimals, decimalToSafeNumber, egpExact, type DecimalString } from "@/lib/decimal";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import {
  buildCostCenterYearMatrix,
  buildCostCenterYearTrend,
  costCenterDescendantIds,
  costCenterHierarchyPresentation,
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
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4"
      data-testid="cost-center-reports"
      style={{ "--ink-muted": "#5f7066" } as CSSProperties}
    >
      <PageHeader
        title="اقتصاديات مراكز التكلفة"
        subtitle="أين تذهب الفلوس، وما الذي ينتجه كل نشاط، من القيود المرحّلة فقط."
        metadata={<StatusPill status={unallocatedLines > 0 || flags.length > 0 ? "blocked" : "done"}>{unallocatedLines > 0 || flags.length > 0 ? "توجد مراجعة" : "لا توجد إشارات"}</StatusPill>}
        actions={<div className="no-print flex flex-wrap gap-2"><PrintButton label="طباعة التقرير" /><Link href="/record" className="fos-btn fos-btn--primary fos-btn--md">سجّل عملية</Link></div>}
      />

      <StoryLine lead={costLead} notes={costNotes} />

      <section aria-label="ملخص مراكز التكلفة" className="grid border-y sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: "var(--line)" }}>
        <Metric label="صافي التشغيل" value={egpExact(displayProfit)} icon={<Scale size={16} aria-hidden />} />
        <Metric label="الإيرادات" value={egpExact(displayRevenue)} icon={<Landmark size={16} aria-hidden />} />
        <Metric label="المصروفات" value={egpExact(displayExpense)} icon={<ReceiptText size={16} aria-hidden />} />
        <Metric label="غير موزع" value={num(unallocatedLines)} icon={<CircleAlert size={16} aria-hidden />} />
      </section>

      <section className="no-print flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex flex-wrap gap-2" aria-label="تصفية المراكز">
          <FilterLink href={reportHref({ view })} active={!center && focus === "all"}>الكل · {num(rollup.length)}</FilterLink>
          <FilterLink href={reportHref({ view, focus: "posted" })} active={!center && focus === "posted"}>لها حركة · {num(hasPosted.size)}</FilterLink>
          <FilterLink href={reportHref({ view, focus: "flags" })} active={!center && focus === "flags"}>تحتاج مراجعة · {num(flags.length)}</FilterLink>
          <FilterLink href={reportHref({ view, center: "CC-UNALLOC" })} active={center === "CC-UNALLOC"}>غير موزع · {num(unallocatedLines)}</FilterLink>
        </div>
        <nav aria-label="نطاق التقرير" className="flex w-fit overflow-hidden rounded-md" style={{ border: "1px solid var(--line)" }}>
          <ReportViewLink href={reportHref({ view: "overview", focus, center })} active={view === "overview"}>الحالي</ReportViewLink>
          <ReportViewLink href={reportHref({ view: "history", focus, center })} active={view === "history"}>حسب السنة</ReportViewLink>
        </nav>
      </section>

      {(selectedCenter || focus !== "all") && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3 text-sm" style={{ borderColor: "var(--line)" }}>
          <strong>{selectedCenter ? `${selectedCenter.code} · ${selectedCenter.nameAr}` : focus === "posted" ? "المراكز التي لها حركة" : "المراكز التي تحتاج مراجعة"}</strong>
          <Link href={reportHref({ view })} className="font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>إلغاء الفلتر</Link>
        </div>
      )}

      <section aria-labelledby="center-list-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 id="center-list-title" className="text-base font-bold">المراكز</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>اضغط على المركز لفتح ملفه الكامل.</p></div>
          <span className="text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>{num(visibleRollup.length)} مركز ظاهر</span>
        </div>
        {visibleRollup.length ? <div className="mt-2 border-y" style={{ borderColor: "var(--line)" }}>{visibleRollup.map((row) => <CenterRow key={row.costCenterId} row={row} flagged={flaggedIds.has(row.costCenterId)} presentation={costCenterHierarchyPresentation(rollup, row.costCenterId)} />)}</div> : <EmptyState title="لا توجد مراكز مطابقة للفلتر" />}
      </section>

      {(centerCharts.length > 0 || trendChart.length > 0) && (
        <section aria-labelledby="center-chart-title" className="border-y py-4" style={{ borderColor: "var(--line)" }}>
          <h2 id="center-chart-title" className="mb-3 text-base font-bold">قارن الصورة</h2>
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
        </section>
      )}

      {(visibleFlags.length > 0 || focus === "flags") && <section aria-labelledby="review-flags-title">
        <h2 id="review-flags-title" className="mb-2 text-base font-bold">ما يحتاج مراجعة</h2>
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
      </section>}

      <details className="border-y py-3" style={{ borderColor: "var(--line)" }}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          <span>الجدول الكامل والتصدير</span><span className="text-xs font-normal" style={{ color: "var(--ink-muted)" }}>كل الأعمدة المحاسبية</span>
        </summary>
        <div className="mt-3">
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
        </div>
      </details>

      {view === "history" && (
        <section aria-labelledby="history-matrix-title">
          <h2 id="history-matrix-title" className="mb-2 text-base font-bold">الحساب × السنة × المركز</h2>
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
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}><div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div><strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>;
}

function CenterRow({ row, flagged, presentation }: { row: CostCenterSnapshotRow; flagged: boolean; presentation: { depth: number; includesDescendants: boolean } }) {
  const scopeSuffix = presentation.includesDescendants ? " · شامل التابع" : "";
  return (
    <Link href={`/finance/cost-centers/${row.costCenterId}`} className="grid min-h-16 gap-2 border-b py-3 last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(7rem,auto))_auto] sm:items-center" style={{ borderColor: "var(--line)" }}>
      <span className="min-w-0" style={{ paddingInlineStart: `${presentation.depth * 16}px` }}><strong className="block truncate">{presentation.depth > 0 ? "تابع · " : ""}{row.nameAr}</strong><span className="text-xs" style={{ color: "var(--ink-muted)" }}>{row.code}{row.enterprise ? ` · ${row.enterprise}` : ""}{presentation.includesDescendants ? " · أرقامه تشمل التابع" : ""}{!row.active ? " · مؤرشف" : ""}</span></span>
      <span className="text-sm"><small className="block text-xs" style={{ color: "var(--ink-muted)" }}>مصروفات{scopeSuffix}</small><b className="tabular-nums">{egpExact(row.expense)}</b></span>
      <span className="text-sm"><small className="block text-xs" style={{ color: "var(--ink-muted)" }}>إيرادات{scopeSuffix}</small><b className="tabular-nums">{egpExact(row.revenue)}</b></span>
      <span className="text-sm"><small className="block text-xs" style={{ color: "var(--ink-muted)" }}>الصافي{scopeSuffix}</small><b className="tabular-nums">{egpExact(row.net)}</b></span>
      <span className="flex items-center gap-2">{flagged && <StatusPill status="blocked">مراجعة</StatusPill>}<ArrowLeft size={17} aria-hidden style={{ color: "var(--brand)" }} /></span>
    </Link>
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
      className="inline-flex min-h-11 items-center justify-center px-4 text-sm font-semibold"
      style={{
        color: active ? "white" : "var(--brand)",
        background: active ? "var(--brand)" : "var(--surface)",
      }}
    >
      {children}
    </Link>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: active ? "white" : "var(--brand)",
        background: active ? "var(--brand)" : "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
