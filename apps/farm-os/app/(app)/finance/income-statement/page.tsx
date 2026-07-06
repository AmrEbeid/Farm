// Income statement / P&L (قائمة الدخل) — read-only owner/accountant statement over the double-entry ledger.
// Calls fn_accounting_income_statement (SPEC-0004 Slice A): posted-only, period-scoped; net income ties to the
// balance sheet. Owner drawings are NOT expenses (excluded by construction, #6). Server Component; finance.read.

import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { parseIncomeStatement, type IncomeStatementLine } from "@/lib/income-statement";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";
import { PeriodPresets } from "@/components/PeriodPresets";
import { PrintButton } from "@/components/print-button";
import { FinanceStatementPrintPacket, type FinanceStatementPrintItem } from "@/components/FinanceStatementPrintPacket";

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
  const generatedOn = isoDate(new Date());

  const res = await sb.rpc("fn_accounting_income_statement", { p_org: m.orgId, p_from: start, p_to: end });
  if (res.error) throw res.error;
  const is = parseIncomeStatement(res.data);
  const periodStart = is.periodStart ?? start;
  const periodEnd = is.periodEnd ?? end;
  const printItems: FinanceStatementPrintItem[] = [
    { id: "statement", label: "نوع القائمة", value: "قائمة الدخل" },
    { id: "period", label: "الفترة", value: `${fmtDate(periodStart)} إلى ${fmtDate(periodEnd)}` },
    { id: "issued", label: "تاريخ الإصدار", value: fmtDate(generatedOn) },
    { id: "source", label: "المصدر", value: "القيود المُرحّلة فقط" },
  ];
  const hasActivity = is.revenue.length > 0 || is.expenses.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">قائمة الدخل (الأرباح والخسائر)</h1>
          <p style={mutedStyle}>
            الإيرادات ناقص المصروفات للفترة من {fmtDate(is.periodStart ?? start)} إلى {fmtDate(is.periodEnd ?? end)} —
            من واقع القيود المُرحّلة. مسحوبات المالك ليست مصروفًا ولا تظهر هنا.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <a
            href={`/api/finance/statements.pdf?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&asOf=${encodeURIComponent(end)}`}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold"
            style={{ border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
          >
            <Download aria-hidden="true" size={16} />
            تنزيل حزمة PDF
          </a>
          <PrintButton label="طباعة القائمة" />
        </div>
      </header>

      <FinanceStatementPrintPacket title="هوية واعتماد قائمة الدخل" items={printItems} />

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
              تحديث القائمة
            </button>
          </div>
        </form>
        <div className="mt-3">
          <PeriodPresets basePath="/finance/income-statement" />
        </div>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="إجمالي الإيرادات" value={egp(hasActivity ? is.revenueTotal : null)} icon="🧾" />
        <KpiCard label="إجمالي المصروفات" value={egp(hasActivity ? is.expensesTotal : null)} icon="📉" />
        <KpiCard label="منها مصروفات تشغيلية" value={egp(hasActivity ? is.operatingExpenses : null)} icon="🛠️" />
        <KpiCard
          label="صافي الربح / الخسارة"
          value={egp(hasActivity ? is.netIncome : null)}
          icon="📈"
          deltaDirection={hasActivity ? (is.netIncome >= 0 ? "up" : "down") : "none"}
        />
      </section>

      <Card title={`الإيرادات — ${egp(hasActivity ? is.revenueTotal : null)}`}>
        {is.revenue.length ? (
          <FilterableTable
            columns={lineColumns}
            rows={toRows(is.revenue)}
            ariaLabel="الإيرادات"
            exportFilename={`income-statement-revenue-${start}-to-${end}.csv`}
          />
        ) : (
          <EmptyState title="لا إيرادات مُرحّلة في هذه الفترة" />
        )}
      </Card>

      <Card title={`المصروفات — ${egp(hasActivity ? is.expensesTotal : null)}`}>
        {is.expenses.length ? (
          <FilterableTable
            columns={lineColumns}
            rows={toRows(is.expenses)}
            ariaLabel="المصروفات"
            exportFilename={`income-statement-expenses-${start}-to-${end}.csv`}
          />
        ) : (
          <EmptyState title="لا مصروفات مُرحّلة في هذه الفترة" />
        )}
      </Card>

      <Card title="النتيجة">
        {hasActivity ? (
          <p style={mutedStyle}>
            الإيرادات {egp(is.revenueTotal)} − المصروفات {egp(is.expensesTotal)} = صافي {is.netIncome >= 0 ? "ربح" : "خسارة"}{" "}
            {egp(is.netIncome)}. يطابق صافي الربح في قائمة المركز المالي لنفس التاريخ.
          </p>
        ) : (
          <p style={mutedStyle}>لا توجد قيود مُرحّلة في هذه الفترة — لا يوجد صافي ربح أو خسارة لعرضه بعد.</p>
        )}
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
