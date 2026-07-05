// Budget vs actual (الموازنة مقابل الفعلي) — read-only owner/accountant report.
// Calls fn_budget_vs_actual (SPEC-0004 Slice A): planned per category (budget_lines) vs LIVE actuals rolled from
// the posted GL by expense category. Report only — it enforces no budget cap. Server Component; finance.read.

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { parseBudgetVsActual } from "@/lib/budget-vs-actual";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

const columns: SimpleColumn[] = [
  { id: "category", header: "الفئة", kind: "text" },
  { id: "planned", header: "المخطط", kind: "money", numeric: true, sortable: true },
  { id: "actual", header: "الفعلي (من القيود)", kind: "money", numeric: true, sortable: true },
  { id: "variance", header: "الفرق", kind: "money", numeric: true, sortable: true },
  { id: "status", header: "الحالة", kind: "text" },
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

  const res = await sb.rpc("fn_budget_vs_actual", { p_org: m.orgId, p_from: start, p_to: end });
  if (res.error) throw res.error;
  const bva = parseBudgetVsActual(res.data);

  const rows: SimpleRow[] = bva.lines.map((l, i) => ({
    id: `${l.category}-${i}`,
    category: l.category,
    planned: l.planned,
    actual: l.actual,
    variance: l.variance,
    status: l.overBudget ? "متجاوز الموازنة" : l.unbudgeted ? "غير مُدرج بالموازنة" : "ضمن الموازنة",
  }));
  const overCount = bva.lines.filter((l) => l.overBudget).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">الموازنة مقابل الفعلي</h1>
        <p style={mutedStyle}>
          المخطط لكل فئة مقابل الإنفاق الفعلي من القيود المُرحّلة للفترة من {fmtDate(bva.periodStart ?? start)} إلى{" "}
          {fmtDate(bva.periodEnd ?? end)}. تقرير للمتابعة فقط — لا يمنع أي اعتماد.
        </p>
      </header>

      <Card title="الفترة">
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
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="إجمالي المخطط" value={egp(bva.plannedTotal)} icon="🎯" />
        <KpiCard label="إجمالي الفعلي" value={egp(bva.actualTotal)} icon="💸" />
        <KpiCard
          label="إجمالي الفرق"
          value={egp(bva.varianceTotal)}
          icon="⚖️"
          deltaDirection={bva.varianceTotal >= 0 ? "up" : "down"}
        />
        <KpiCard label="فئات متجاوزة الموازنة" value={String(overCount)} icon="🚩" deltaDirection={overCount > 0 ? "down" : "none"} />
      </section>

      <Card title="الموازنة مقابل الفعلي حسب الفئة">
        {rows.length ? (
          <FilterableTable columns={columns} rows={rows} ariaLabel="الموازنة مقابل الفعلي" exportFilename="budget-vs-actual" />
        ) : (
          <EmptyState title="لا موازنة ولا إنفاق مُرحّل في هذه الفترة" description="أضِف بنود موازنة أو رحّل مصروفات لتظهر المقارنة." />
        )}
        <p className="mt-3 text-sm" style={mutedStyle}>
          «الفعلي» يُحسب من القيود المُرحّلة (المدفوعة) ويُجمّع حسب فئة المصروف. البنود «غير المُدرجة بالموازنة» إنفاق
          فعلي بلا بند موازنة مطابق — راجِع تسمية الفئات أو أضِف بندًا. حدّ الموازنة (منع الاعتماد) قرار مالك منفصل.
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
