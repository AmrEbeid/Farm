import type { ReactNode } from "react";
import Link from "next/link";
import { Download, ReceiptText, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { EmptyState, StatusPill } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { compareDecimals, egpExact } from "@/lib/decimal";
import { fmtDate } from "@/lib/dates";
import { parseIncomeStatement, type IncomeStatementLine } from "@/lib/income-statement";
import { incomeStatementExportRows } from "@/lib/financial-statement-export";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";
import { PeriodPresets } from "@/components/PeriodPresets";
import { PrintButton } from "@/components/print-button";
import { FinanceStatementPrintPacket, type FinanceStatementPrintItem } from "@/components/FinanceStatementPrintPacket";
import { normalizeFinanceReportDateRange } from "@/lib/finance report routing";
import { FinancePnlTrend } from "@/components/FinancePnlTrend";
import { PageHeader } from "@/components/PageHeader";
import { StoryLine } from "@/components/StoryLine";

const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const lineColumns: SimpleColumn[] = [
  { id: "code", header: "الحساب", kind: "code" },
  { id: "name_ar", header: "الاسم" },
  { id: "amount", header: "المبلغ", kind: "money-exact", numeric: true, decimal: true, sortable: true },
];

export default async function FinanceIncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string | string[]; end?: string | string[]; view?: string | string[]; grain?: string | string[] }>;
}) {
  const member = await requireRole(["owner", "accountant"]);
  const params = await searchParams;
  if (params.view === "trend") return <FinancePnlTrend orgId={member.orgId} grain={params.grain === "year" ? "year" : "month"} />;

  const { start, end } = normalizeFinanceReportDateRange({
    start: params.start,
    end: params.end,
    fallbackStart: firstOfMonth(),
    fallbackEnd: isoDate(new Date()),
  });
  const sb = await createClient();
  const result = await sb.rpc("fn_accounting_income_statement_snapshot", { p_org: member.orgId, p_from: start, p_to: end });
  if (result.error) throw result.error;
  const statement = parseIncomeStatement(result.data, member.orgId, start, end);
  const hasActivity = statement.revenue.length > 0 || statement.expenses.length > 0;
  const profit = compareDecimals(statement.netIncome, "0") >= 0;
  const today = isoDate(new Date());
  const printItems: FinanceStatementPrintItem[] = [
    { id: "statement", label: "نوع القائمة", value: "قائمة الدخل" },
    { id: "period", label: "الفترة", value: `${fmtDate(start)} إلى ${fmtDate(end)}` },
    { id: "issued", label: "تاريخ الإصدار", value: fmtDate(today) },
    { id: "source", label: "المصدر", value: "القيود المُرحّلة فقط" },
  ];
  const lead = !hasActivity
    ? "لا توجد إيرادات أو مصروفات مُرحّلة في هذه الفترة؛ لا توجد نتيجة مالية للاعتماد بعد."
    : `حققت الفترة إيرادات ${egpExact(statement.revenueTotal)} مقابل مصروفات ${egpExact(statement.expensesTotal)} — صافي ${profit ? "ربح" : "خسارة"} ${egpExact(statement.netIncome)}.`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4" data-testid="income-statement">
      <PageHeader
        title="قائمة الدخل"
        subtitle={`نتيجة الفترة من ${fmtDate(start)} إلى ${fmtDate(end)} من القيود المُرحّلة فقط.`}
        metadata={<StatusPill status={!hasActivity ? "draft" : profit ? "done" : "blocked"}>{!hasActivity ? "لا توجد حركة" : profit ? "ربح" : "خسارة"}</StatusPill>}
        actions={<div className="no-print flex flex-wrap gap-2"><Link href="/finance/income-statement?view=trend&grain=month" className="fos-btn fos-btn--secondary fos-btn--md">عرض الاتجاه</Link><a href={`/api/finance/statements.pdf?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&asOf=${encodeURIComponent(end)}`} className="fos-btn fos-btn--secondary fos-btn--md"><Download aria-hidden size={16} /> حزمة PDF</a><PrintButton label="طباعة القائمة" /></div>}
      />

      <StoryLine lead={lead} notes={["مسحوبات المالك ليست مصروفًا ولا تدخل في هذه القائمة."]} />
      <FinanceStatementPrintPacket title="هوية واعتماد قائمة الدخل" items={printItems} />

      <section aria-label="ملخص قائمة الدخل" className="grid border-y sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: "var(--line)" }}>
        <Metric label="الإيرادات" value={hasActivity ? egpExact(statement.revenueTotal) : "—"} icon={<TrendingUp size={16} aria-hidden />} />
        <Metric label="المصروفات" value={hasActivity ? egpExact(statement.expensesTotal) : "—"} icon={<TrendingDown size={16} aria-hidden />} />
        <Metric label="منها تشغيلي" value={hasActivity ? egpExact(statement.operatingExpenses) : "—"} icon={<ReceiptText size={16} aria-hidden />} />
        <Metric label={profit ? "صافي الربح" : "صافي الخسارة"} value={hasActivity ? egpExact(statement.netIncome) : "—"} icon={<Scale size={16} aria-hidden />} />
      </section>

      <section className="no-print border-b pb-4" style={{ borderColor: "var(--line)" }} aria-labelledby="income-period-title">
        <h2 id="income-period-title" className="mb-2 text-sm font-bold">الفترة</h2>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex min-w-52 flex-col gap-1 text-sm font-semibold">من تاريخ<input name="start" type="date" defaultValue={start} className="rounded-md px-3 py-2" style={inputStyle} /></label>
          <label className="flex min-w-52 flex-col gap-1 text-sm font-semibold">إلى تاريخ<input name="end" type="date" defaultValue={end} className="rounded-md px-3 py-2" style={inputStyle} /></label>
          <button type="submit" className="fos-btn fos-btn--primary fos-btn--md">تحديث</button>
        </form>
        <div className="mt-3"><PeriodPresets basePath="/finance/income-statement" /></div>
      </section>

      <StatementSection title="الإيرادات" total={statement.revenueTotal} lines={statement.revenue} rows={incomeStatementExportRows(statement.revenue)} empty="لا إيرادات مُرحّلة في هذه الفترة" filename={`income-statement-revenue-${start}-to-${end}.csv`} />
      <StatementSection title="المصروفات" total={statement.expensesTotal} lines={statement.expenses} rows={incomeStatementExportRows(statement.expenses)} empty="لا مصروفات مُرحّلة في هذه الفترة" filename={`income-statement-expenses-${start}-to-${end}.csv`} />

      <section className="border-y py-3 text-sm" style={{ borderColor: "var(--line)" }}><strong>النتيجة: </strong>{hasActivity ? `الإيرادات ${egpExact(statement.revenueTotal)} ناقص المصروفات ${egpExact(statement.expensesTotal)} = صافي ${profit ? "ربح" : "خسارة"} ${egpExact(statement.netIncome)}.` : "لا توجد حركة لحساب نتيجة الفترة."}</section>
      <FinanceStatementsNav current="income-statement" />
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}><div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div><strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>;
}

function StatementSection({ title, total, lines, rows, empty, filename }: { title: string; total: string; lines: IncomeStatementLine[]; rows: SimpleRow[]; empty: string; filename: string }) {
  return <section aria-labelledby={`${filename}-title`}><div className="mb-2 flex flex-wrap items-end justify-between gap-2"><h2 id={`${filename}-title`} className="text-base font-bold">{title}</h2><strong className="tabular-nums">{egpExact(total)}</strong></div>{lines.length ? <FilterableTable columns={lineColumns} rows={rows} ariaLabel={title} exportFilename={filename} minRowsForSearch={1} /> : <EmptyState title={empty} />}</section>;
}

function isoDate(date: Date): string { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function firstOfMonth(): string { const date = new Date(); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`; }
function pad(value: number): string { return String(value).padStart(2, "0"); }
