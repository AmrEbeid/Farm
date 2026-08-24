import type { ReactNode } from "react";
import { Download, Landmark, Scale, TrendingUp, WalletCards } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { EmptyState, StatusPill } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egpExact } from "@/lib/decimal";
import { compareDecimals } from "@/lib/decimal";
import { fmtDate } from "@/lib/dates";
import { parseBalanceSheet, type BalanceSheetLine } from "@/lib/balance-sheet";
import { balanceSheetExportRows } from "@/lib/financial-statement-export";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";
import { PeriodPresets } from "@/components/PeriodPresets";
import { PrintButton } from "@/components/print-button";
import { FinanceStatementPrintPacket, type FinanceStatementPrintItem } from "@/components/FinanceStatementPrintPacket";
import { PageHeader } from "@/components/PageHeader";
import { StoryLine } from "@/components/StoryLine";

const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

const sectionColumns: SimpleColumn[] = [
  { id: "code", header: "الحساب", kind: "code" },
  { id: "name_ar", header: "الاسم" },
  { id: "balance", header: "الرصيد", kind: "money-exact", numeric: true, decimal: true, sortable: true },
];

export default async function FinanceBalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const member = await requireRole(["owner", "accountant"]);
  const params = await searchParams;
  const today = isoDate(new Date());
  const asOf = parseDateParam(params.asOf, today);
  const sb = await createClient();
  const result = await sb.rpc("fn_accounting_balance_sheet_snapshot", { p_org: member.orgId, p_as_of: asOf });
  if (result.error) throw result.error;
  const statement = parseBalanceSheet(result.data, member.orgId, asOf);
  const hasData = statement.assets.length > 0 || statement.liabilities.length > 0 || statement.equity.length > 0;
  const profit = compareDecimals(statement.netIncome, "0") >= 0;
  const printItems: FinanceStatementPrintItem[] = [
    { id: "statement", label: "نوع القائمة", value: "قائمة المركز المالي" },
    { id: "as-of", label: "تاريخ القائمة", value: fmtDate(statement.asOf) },
    { id: "issued", label: "تاريخ الإصدار", value: fmtDate(today) },
    { id: "source", label: "المصدر", value: "القيود المُرحّلة فقط" },
  ];
  const lead = !hasData
    ? "لا توجد قيود مُرحّلة حتى هذا التاريخ؛ لا توجد قائمة مالية للاعتماد بعد."
    : statement.balanced
      ? `الموارد ${egpExact(statement.assetsTotal)} وتساوي الالتزامات وحقوق المالك؛ القائمة متوازنة حتى ${fmtDate(statement.asOf)}.`
      : `توقف عن الاعتماد: الموارد ${egpExact(statement.assetsTotal)} لا تساوي الالتزامات وحقوق المالك ${egpExact(statement.liabilitiesPlusEquity)}.`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4" data-testid="balance-sheet">
      <PageHeader
        title="قائمة المركز المالي"
        subtitle={`الموارد والالتزامات وحقوق المالك من القيود المُرحّلة حتى ${fmtDate(statement.asOf)}.`}
        metadata={
          <StatusPill status={!hasData ? "draft" : statement.balanced ? "done" : "blocked"}>
            {!hasData ? "لا توجد حركة" : statement.balanced ? "متوازنة" : "غير متوازنة"}
          </StatusPill>
        }
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <a
              href={`/api/finance/statements.pdf?start=${encodeURIComponent(monthStartFor(asOf))}&end=${encodeURIComponent(asOf)}&asOf=${encodeURIComponent(asOf)}`}
              className="fos-btn fos-btn--secondary fos-btn--md"
            >
              <Download aria-hidden size={16} /> حزمة القوائم
            </a>
            <a
              href={`/api/finance/balance-sheet.pdf?asOf=${encodeURIComponent(asOf)}`}
              className="fos-btn fos-btn--secondary fos-btn--md"
            >
              <Download aria-hidden size={16} /> PDF
            </a>
            <PrintButton label="طباعة القائمة" />
          </div>
        }
      />

      <StoryLine
        lead={lead}
        notes={hasData ? [`صافي ${profit ? "الربح" : "الخسارة"} المتراكم ${egpExact(statement.netIncome)}. مسحوبات المالك معروضة داخل حقوق المالك وليست مصروفًا.`] : []}
      />

      <FinanceStatementPrintPacket title="هوية واعتماد قائمة المركز المالي" items={printItems} />

      <section aria-label="ملخص قائمة المركز المالي" className="grid border-y sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: "var(--line)" }}>
        <Metric label="الموارد" value={hasData ? egpExact(statement.assetsTotal) : "—"} icon={<Landmark size={16} aria-hidden />} />
        <Metric label="الالتزامات" value={hasData ? egpExact(statement.liabilitiesTotal) : "—"} icon={<WalletCards size={16} aria-hidden />} />
        <Metric label="حقوق المالك مع الربح" value={hasData ? egpExact(statement.totalEquityInclIncome) : "—"} icon={<Scale size={16} aria-hidden />} />
        <Metric label={profit ? "صافي الربح" : "صافي الخسارة"} value={hasData ? egpExact(statement.netIncome) : "—"} icon={<TrendingUp size={16} aria-hidden />} />
      </section>

      <section className="no-print border-b pb-4" style={{ borderColor: "var(--line)" }} aria-labelledby="balance-date-title">
        <h2 id="balance-date-title" className="mb-2 text-sm font-bold">تاريخ القائمة</h2>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex min-w-52 flex-col gap-1 text-sm font-semibold">
            حتى تاريخ
            <input name="asOf" type="date" defaultValue={asOf} className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <button type="submit" className="fos-btn fos-btn--primary fos-btn--md">تحديث</button>
        </form>
        <div className="mt-3"><PeriodPresets basePath="/finance/balance-sheet" mode="asOf" /></div>
      </section>

      {!statement.balanced && hasData ? (
        <section className="border-y py-3" style={{ borderColor: "var(--danger, #b23b3b)" }} aria-labelledby="balance-blocker-title">
          <h2 id="balance-blocker-title" className="font-bold" style={{ color: "var(--danger, #b23b3b)" }}>القائمة غير متوازنة ولا تصلح للاعتماد</h2>
          <p className="mt-1 text-sm">راجع القيود: الفرق بين الموارد والطرف المقابل يجب أن يكون صفرًا.</p>
        </section>
      ) : null}

      <StatementSection title="الموارد" total={statement.assetsTotal} lines={statement.assets} rows={balanceSheetExportRows(statement.assets)} empty="لا موارد بأرصدة حتى هذا التاريخ" filename={`balance-sheet-assets-${asOf}.csv`} />
      <StatementSection title="الالتزامات" total={statement.liabilitiesTotal} lines={statement.liabilities} rows={balanceSheetExportRows(statement.liabilities)} empty="لا التزامات حتى هذا التاريخ" filename={`balance-sheet-liabilities-${asOf}.csv`} />
      <StatementSection title="حقوق المالك" total={statement.equityTotal} lines={statement.equity} rows={balanceSheetExportRows(statement.equity)} empty="لا حقوق مالك حتى هذا التاريخ" filename={`balance-sheet-equity-${asOf}.csv`} note={hasData ? `تشمل مسحوبات مالك ${egpExact(statement.drawingsTotal)}، ثم يضاف صافي الفترة ${egpExact(statement.netIncome)}.` : undefined} />

      <section className="border-y py-3 text-sm" style={{ borderColor: "var(--line)" }}>
        <strong>التحقق المحاسبي: </strong>
        {hasData ? `الموارد ${egpExact(statement.assetsTotal)} = الالتزامات + حقوق المالك + صافي الربح ${egpExact(statement.liabilitiesPlusEquity)}.` : "لا توجد حركة للتحقق منها."}
      </section>

      <FinanceStatementsNav current="balance-sheet" />
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}><div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div><strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>;
}

function StatementSection({ title, total, lines, rows, empty, filename, note }: { title: string; total: string; lines: BalanceSheetLine[]; rows: SimpleRow[]; empty: string; filename: string; note?: string }) {
  return <section aria-labelledby={`${filename}-title`}><div className="mb-2 flex flex-wrap items-end justify-between gap-2"><h2 id={`${filename}-title`} className="text-base font-bold">{title}</h2><strong className="tabular-nums">{egpExact(total)}</strong></div>{lines.length ? <FilterableTable columns={sectionColumns} rows={rows} ariaLabel={title} exportFilename={filename} minRowsForSearch={1} /> : <EmptyState title={empty} />}{note ? <p className="mt-2 text-xs" style={{ color: "var(--ink-muted)" }}>{note}</p> : null}</section>;
}

function parseDateParam(value: string | undefined, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return value > fallback ? fallback : value;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStartFor(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
