// Income statement / P&L (قائمة الدخل) — read-only owner/accountant statement over the double-entry ledger.
// Calls fn_accounting_income_statement (SPEC-0004 Slice A): posted-only, period-scoped; net income ties to the
// balance sheet. Owner drawings are NOT expenses (excluded by construction, #6). Server Component; finance.read.

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { parseIncomeStatement, type IncomeStatementLine } from "@/lib/income-statement";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

const lineColumns: SimpleColumn[] = [
  { id: "code", header: "الحساب", kind: "code" },
  { id: "name_ar", header: "الاسم" },
  { id: "amount", header: "المبلغ", kind: "money", numeric: true, sortable: true },
];

function toRows(lines: IncomeStatementLine[]): SimpleRow[] {
  return lines.map((line, i) => ({
    id: `${line.code}-${i}`,
    code: line.code,
    name_ar: line.nameAr,
    amount: line.amount,
  }));
}

export default async function FinanceIncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const start = parseDateParam(params.start, firstOfMonth());
  const end = parseDateParam(params.end, isoDate(new Date()));

  const res = await sb.rpc("fn_accounting_income_statement", { p_org: m.orgId, p_from: start, p_to: end });
  if (res.error) throw res.error;
  const is = parseIncomeStatement(res.data);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">قائمة الدخل (الأرباح والخسائر)</h1>
        <p style={mutedStyle}>
          الإيرادات ناقص المصروفات للفترة من {fmtDate(is.periodStart ?? start)} إلى {fmtDate(is.periodEnd ?? end)} —
          من واقع القيود المُرحّلة. مسحوبات المالك ليست مصروفًا ولا تظهر هنا.
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
              تحديث القائمة
            </button>
          </div>
        </form>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="إجمالي الإيرادات" value={egp(is.revenueTotal)} icon="🧾" />
        <KpiCard label="إجمالي المصروفات" value={egp(is.expensesTotal)} icon="📉" />
        <KpiCard label="منها مصروفات تشغيلية" value={egp(is.operatingExpenses)} icon="🛠️" />
        <KpiCard
          label="صافي الربح / الخسارة"
          value={egp(is.netIncome)}
          icon="📈"
          deltaDirection={is.netIncome >= 0 ? "up" : "down"}
        />
      </section>

      <Card title={`الإيرادات — ${egp(is.revenueTotal)}`}>
        {is.revenue.length ? (
          <FilterableTable columns={lineColumns} rows={toRows(is.revenue)} ariaLabel="الإيرادات" exportFilename="income-statement-revenue" />
        ) : (
          <EmptyState title="لا إيرادات مُرحّلة في هذه الفترة" />
        )}
      </Card>

      <Card title={`المصروفات — ${egp(is.expensesTotal)}`}>
        {is.expenses.length ? (
          <FilterableTable columns={lineColumns} rows={toRows(is.expenses)} ariaLabel="المصروفات" exportFilename="income-statement-expenses" />
        ) : (
          <EmptyState title="لا مصروفات مُرحّلة في هذه الفترة" />
        )}
      </Card>

      <Card title="النتيجة">
        <p style={mutedStyle}>
          الإيرادات {egp(is.revenueTotal)} − المصروفات {egp(is.expensesTotal)} = صافي {is.netIncome >= 0 ? "ربح" : "خسارة"}{" "}
          {egp(is.netIncome)}. يطابق صافي الربح في قائمة المركز المالي لنفس التاريخ.
        </p>
      </Card>

      <FinanceStatementsNav current="income-statement" />
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
