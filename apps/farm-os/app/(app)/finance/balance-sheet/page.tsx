// Balance sheet (قائمة المركز المالي) — read-only owner/accountant statement over the double-entry ledger.
// Calls fn_accounting_balance_sheet (SPEC-0004 Slice A): posted-only, as-of-scoped, self-checking `balanced`.
// Server Component; role enforced here AND in the RPC (finance.read).

import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { parseBalanceSheet, type BalanceSheetLine } from "@/lib/balance-sheet";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";
import { PeriodPresets } from "@/components/PeriodPresets";
import { PrintButton } from "@/components/print-button";
import { FinanceStatementPrintPacket, type FinanceStatementPrintItem } from "@/components/FinanceStatementPrintPacket";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

const sectionColumns: SimpleColumn[] = [
  { id: "code", header: "الحساب", kind: "code" },
  { id: "name_ar", header: "الاسم" },
  { id: "balance", header: "الرصيد", kind: "money", numeric: true, sortable: true },
];

function toRows(lines: BalanceSheetLine[]): SimpleRow[] {
  return lines.map((line, i) => ({
    id: `${line.code}-${i}`,
    code: line.code,
    name_ar: line.nameAr,
    balance: line.balance,
  }));
}

export default async function FinanceBalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const asOf = parseDateParam(params.asOf, isoDate(new Date()));
  const generatedOn = isoDate(new Date());

  const res = await sb.rpc("fn_accounting_balance_sheet", { p_org: m.orgId, p_as_of: asOf });
  if (res.error) throw res.error;
  const bs = parseBalanceSheet(res.data);
  const statementAsOf = bs.asOf ?? asOf;
  const printItems: FinanceStatementPrintItem[] = [
    { id: "statement", label: "نوع القائمة", value: "قائمة المركز المالي" },
    { id: "as-of", label: "تاريخ القائمة", value: fmtDate(statementAsOf) },
    { id: "issued", label: "تاريخ الإصدار", value: fmtDate(generatedOn) },
    { id: "source", label: "المصدر", value: "القيود المُرحّلة فقط" },
  ];

  // Honest-null (#1): an org with no posted entries makes every total 0, so `balanced` is trivially true
  // (0 = 0). Showing "0 ج.م" KPIs and a green "متوازنة ✓" would read as a real, reconciled statement. When
  // there is no data, render "—" and say so plainly instead of a fabricated balanced-at-zero statement.
  const hasData = bs.assets.length > 0 || bs.liabilities.length > 0 || bs.equity.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">قائمة المركز المالي</h1>
          <p style={mutedStyle}>
            صورة فعلية من القيود المُرحّلة حتى {fmtDate(bs.asOf ?? asOf)} — الموارد والالتزامات وحقوق المالك.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <a
            href={`/api/finance/balance-sheet.pdf?asOf=${encodeURIComponent(asOf)}`}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold"
            style={{ border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
          >
            <Download aria-hidden="true" size={16} />
            تنزيل PDF
          </a>
          <PrintButton label="طباعة القائمة" />
        </div>
      </header>

      <FinanceStatementPrintPacket title="هوية واعتماد قائمة المركز المالي" items={printItems} />

      <Card title="التاريخ" className="no-print">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            تاريخ القائمة
            <input name="asOf" type="date" defaultValue={asOf} className="rounded-md px-3 py-2" style={inputStyle} />
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
          <PeriodPresets basePath="/finance/balance-sheet" mode="asOf" />
        </div>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="إجمالي الموارد" value={egp(hasData ? bs.assetsTotal : null)} icon="🏦" />
        <KpiCard label="إجمالي الالتزامات" value={egp(hasData ? bs.liabilitiesTotal : null)} icon="📉" />
        <KpiCard label="حقوق المالك (متضمّنة الربح)" value={egp(hasData ? bs.totalEquityInclIncome : null)} icon="👤" />
        <KpiCard
          label="صافي الربح المُجمّع حتى التاريخ"
          value={egp(hasData ? bs.netIncome : null)}
          icon="📈"
          deltaDirection={hasData && bs.netIncome >= 0 ? "up" : "down"}
        />
      </section>

      {!bs.balanced && (
        <Card title="⚠️ القائمة غير متوازنة">
          <p className="font-semibold">
            الموارد ({egp(bs.assetsTotal)}) لا تساوي الالتزامات + حقوق المالك + صافي الربح ({egp(bs.liabilitiesPlusEquity)}).
            راجع القيود قبل الاعتماد على هذه القائمة.
          </p>
        </Card>
      )}

      <Card title={`الموارد — ${egp(bs.assetsTotal)}`}>
        {bs.assets.length ? (
          <FilterableTable
            columns={sectionColumns}
            rows={toRows(bs.assets)}
            ariaLabel="الموارد"
            exportFilename={`balance-sheet-assets-${asOf}.csv`}
          />
        ) : (
          <EmptyState title="لا موارد بأرصدة حتى هذا التاريخ" />
        )}
      </Card>

      <Card title={`الالتزامات — ${egp(bs.liabilitiesTotal)}`}>
        {bs.liabilities.length ? (
          <FilterableTable
            columns={sectionColumns}
            rows={toRows(bs.liabilities)}
            ariaLabel="الالتزامات"
            exportFilename={`balance-sheet-liabilities-${asOf}.csv`}
          />
        ) : (
          <EmptyState title="لا التزامات حتى هذا التاريخ" />
        )}
      </Card>

      <Card title={`حقوق المالك — ${egp(bs.equityTotal)}`} subtitle={`منها مسحوبات المالك: ${egp(bs.drawingsTotal)}`}>
        {bs.equity.length ? (
          <FilterableTable
            columns={sectionColumns}
            rows={toRows(bs.equity)}
            ariaLabel="حقوق المالك"
            exportFilename={`balance-sheet-equity-${asOf}.csv`}
          />
        ) : (
          <EmptyState title="لا حقوق مالك حتى هذا التاريخ" />
        )}
        {hasData && (
          <p className="mt-3 text-sm" style={mutedStyle}>
            حقوق المالك {egp(bs.equityTotal)} + صافي الربح المُجمّع {egp(bs.netIncome)} = {egp(bs.totalEquityInclIncome)}
          </p>
        )}
      </Card>

      <Card title="التحقق المحاسبي">
        {hasData ? (
          <p style={mutedStyle}>
            الموارد {egp(bs.assetsTotal)} = الالتزامات + حقوق المالك + صافي الربح {egp(bs.liabilitiesPlusEquity)} —{" "}
            {bs.balanced ? "القائمة متوازنة ✓" : "غير متوازنة ✗"}
          </p>
        ) : (
          <p style={mutedStyle}>لا توجد قيود مُرحّلة حتى هذا التاريخ — لا شيء لعرضه بعد.</p>
        )}
      </Card>

      <FinanceStatementsNav current="balance-sheet" />
    </div>
  );
}

function parseDateParam(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
