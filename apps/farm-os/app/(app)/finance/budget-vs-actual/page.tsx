// Budget vs actual (الموازنة مقابل الفعلي) — read-only owner/accountant report.
// Calls fn_budget_vs_actual (SPEC-0004 Slice A): planned per category (budget_lines) vs LIVE actuals rolled from
// the posted GL by expense category. Report only — it enforces no budget cap. Server Component; finance.read.

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { parseBudgetVsActual } from "@/lib/budget-vs-actual";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";
import { PeriodPresets } from "@/components/PeriodPresets";
import { PrintButton } from "@/components/print-button";
import { FinanceStatementPrintPacket, type FinanceStatementPrintItem } from "@/components/FinanceStatementPrintPacket";
import { getDataAuthority, isAuthoritative } from "@/lib/data-authority";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

const comparisonColumns: SimpleColumn[] = [
  { id: "category", header: "الفئة", kind: "text" },
  { id: "planned", header: "المخطط", kind: "money", numeric: true, sortable: true },
  { id: "actual", header: "الفعلي (من القيود)", kind: "money", numeric: true, sortable: true },
  { id: "variance", header: "الفرق", kind: "money", numeric: true, sortable: true },
  { id: "status", header: "الحالة", kind: "text" },
];
const actualOnlyColumns: SimpleColumn[] = [
  { id: "category", header: "الفئة", kind: "text" },
  { id: "actual", header: "الفعلي (من القيود)", kind: "money", numeric: true, sortable: true },
  { id: "coverage", header: "تغطية المصدر", kind: "text" },
];

export default async function FinanceBudgetVsActualPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const start = parseDateParam(params.start, firstOfMonth());
  const end = parseDateParam(params.end, isoDate(new Date()));
  const generatedOn = isoDate(new Date());

  const [res, budgetAuthority, ledgerAuthority] = await Promise.all([
    sb.rpc("fn_budget_vs_actual", { p_org: m.orgId, p_from: start, p_to: end }),
    getDataAuthority(sb, m.orgId, "budgets"),
    getDataAuthority(sb, m.orgId, "finance_ledger"),
  ]);
  if (res.error) throw res.error;
  const bva = parseBudgetVsActual(res.data);
  const budgetVerified = isAuthoritative(budgetAuthority.status);
  const ledgerVerified = isAuthoritative(ledgerAuthority.status);
  const canCompare = budgetVerified && ledgerVerified;
  const periodStart = bva.periodStart ?? start;
  const periodEnd = bva.periodEnd ?? end;
  const printItems: FinanceStatementPrintItem[] = [
    { id: "report", label: "نوع التقرير", value: "الموازنة مقابل الفعلي" },
    { id: "period", label: "الفترة", value: `${fmtDate(periodStart)} إلى ${fmtDate(periodEnd)}` },
    { id: "issued", label: "تاريخ الإصدار", value: fmtDate(generatedOn) },
    {
      id: "source",
      label: "المصدر",
      value: canCompare
        ? "الموازنة المعتمدة والفعلي من القيود المُرحّلة"
        : ledgerVerified
          ? "الفعلي فقط من القيود المُرحّلة"
          : "الفعلي من قيود مُرحّلة ذات تغطية جزئية",
    },
  ];

  const reportLines = canCompare ? bva.lines : bva.lines.filter((line) => line.actualRowPresent);
  const hasReportRows = reportLines.length > 0;
  const rows: SimpleRow[] = reportLines.map((l, i) => ({
    id: `${l.category}-${i}`,
    category: l.category,
    planned: canCompare ? l.planned : undefined,
    actual: l.actual,
    variance: canCompare ? l.variance : undefined,
    status: canCompare ? (l.overBudget ? "متجاوز الموازنة" : l.unbudgeted ? "غير مُدرج بالموازنة" : "ضمن الموازنة") : undefined,
    coverage: canCompare ? undefined : ledgerVerified ? "قيود موثقة" : "تغطية جزئية",
  }));
  const overCount = bva.lines.filter((l) => l.overBudget).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">الموازنة مقابل الفعلي</h1>
          <p style={mutedStyle}>
            {canCompare ? "المخطط لكل فئة مقابل الإنفاق الفعلي" : "الإنفاق الفعلي"} من القيود المُرحّلة للفترة من {fmtDate(bva.periodStart ?? start)} إلى{" "}
            {fmtDate(bva.periodEnd ?? end)}. تقرير للمتابعة فقط — لا يمنع أي اعتماد.
          </p>
        </div>
        <PrintButton label="طباعة التقرير" />
      </header>

      <FinanceStatementPrintPacket title="هوية ومراجعة تقرير الموازنة مقابل الفعلي" items={printItems} />
      {!canCompare && (
        <Alert
          tone="warning"
          title="عرض الفعلي فقط"
          description="لم يكتمل اعتماد مصدر الموازنة والقيود معًا، لذلك حُجبت المقارنة والفروق. الإنفاق الفعلي أدناه مصدره القيود المُرحّلة ويظل متاحًا."
        />
      )}
      {!ledgerVerified && (
        <Alert
          tone="warning"
          title="تغطية القيود جزئية"
          description="القيود المُرحّلة متوازنة، لكن مطابقة المصدر لم تكتمل. الأرقام المعروضة لا تمثل كل سجلات المصدر بعد."
        />
      )}

      <Card title="الفترة" className="no-print">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            من تاريخ
            <input name="start" type="date" defaultValue={start} className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            إلى تاريخ
            <input name="end" type="date" defaultValue={end} className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="rounded-md px-4 py-2 font-semibold"
              style={{ color: "white", background: "var(--brand)" }}
            >
              تحديث التقرير
            </button>
          </div>
        </form>
        <div className="mt-3">
          <PeriodPresets basePath="/finance/budget-vs-actual" />
        </div>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="إجمالي المخطط" value={canCompare ? egp(hasReportRows ? bva.plannedTotal : null) : "—"} icon="🎯" />
        <KpiCard label={ledgerVerified ? "إجمالي الفعلي" : "الفعلي المسجل جزئيًا"} value={egp(hasReportRows ? bva.actualTotal : null)} icon="💸" />
        <KpiCard
          label="إجمالي الفرق"
          value={canCompare ? egp(hasReportRows ? bva.varianceTotal : null) : "—"}
          icon="⚖️"
          deltaDirection={canCompare && hasReportRows ? (bva.varianceTotal >= 0 ? "up" : "down") : "none"}
        />
        <KpiCard
          label="فئات متجاوزة الموازنة"
          value={canCompare && hasReportRows ? String(overCount) : "—"}
          icon="🚩"
          deltaDirection={canCompare && hasReportRows && overCount > 0 ? "down" : "none"}
        />
      </section>

      <Card title={canCompare ? "الموازنة مقابل الفعلي حسب الفئة" : "الإنفاق الفعلي حسب الفئة"}>
        {rows.length ? (
          <FilterableTable
            columns={canCompare ? comparisonColumns : actualOnlyColumns}
            rows={rows}
            ariaLabel="الموازنة مقابل الفعلي"
            exportFilename={`${canCompare ? "budget-vs-actual" : "actual-spend"}-${start}-to-${end}.csv`}
          />
        ) : (
          <EmptyState
            title={canCompare ? "لا موازنة ولا إنفاق مُرحّل في هذه الفترة" : "لا يوجد إنفاق مُرحّل في هذه الفترة"}
            description={
              canCompare
                ? "أضِف بنود موازنة أو رحّل مصروفات لتظهر المقارنة."
                : "رحّل المصروفات لتظهر قيم الإنفاق الفعلي."
            }
          />
        )}
        <p className="mt-3 text-sm" style={mutedStyle}>
          «الفعلي» يُحسب من القيود المُرحّلة (المدفوعة) ويُجمّع حسب فئة المصروف.
          {canCompare
            ? " البنود غير المُدرجة بالموازنة هي إنفاق فعلي بلا بند مطابق. حدّ الموازنة قرار مالك منفصل."
            : " لم تُحسب مقارنة أو فروق لأن مصدر الموازنة غير معتمد."}
        </p>
      </Card>

      <FinanceStatementsNav current="budget-vs-actual" />
    </div>
  );
}

function parseDateParam(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
