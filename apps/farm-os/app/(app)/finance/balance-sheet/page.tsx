// Balance sheet (قائمة المركز المالي) — read-only owner/accountant statement over the double-entry ledger.
// Calls fn_accounting_balance_sheet (SPEC-0004 Slice A): posted-only, as-of-scoped, self-checking `balanced`.
// Server Component; role enforced here AND in the RPC (finance.read).

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { parseBalanceSheet, type BalanceSheetLine } from "@/lib/balance-sheet";

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

  const res = await sb.rpc("fn_accounting_balance_sheet", { p_org: m.orgId, p_as_of: asOf });
  if (res.error) throw res.error;
  const bs = parseBalanceSheet(res.data);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">قائمة المركز المالي</h1>
        <p style={mutedStyle}>
          صورة فعلية من القيود المُرحّلة حتى {fmtDate(bs.asOf ?? asOf)} — الموارد والالتزامات وحقوق المالك.
        </p>
      </header>

      <Card title="التاريخ">
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
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="إجمالي الموارد" value={egp(bs.assetsTotal)} icon="🏦" />
        <KpiCard label="إجمالي الالتزامات" value={egp(bs.liabilitiesTotal)} icon="📉" />
        <KpiCard label="حقوق المالك (متضمّنة الربح)" value={egp(bs.totalEquityInclIncome)} icon="👤" />
        <KpiCard
          label="صافي الربح للفترة"
          value={egp(bs.netIncome)}
          icon="📈"
          deltaDirection={bs.netIncome >= 0 ? "up" : "down"}
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
          <FilterableTable columns={sectionColumns} rows={toRows(bs.assets)} ariaLabel="الموارد" exportFilename="balance-sheet-assets" />
        ) : (
          <EmptyState title="لا موارد بأرصدة حتى هذا التاريخ" />
        )}
      </Card>

      <Card title={`الالتزامات — ${egp(bs.liabilitiesTotal)}`}>
        {bs.liabilities.length ? (
          <FilterableTable columns={sectionColumns} rows={toRows(bs.liabilities)} ariaLabel="الالتزامات" exportFilename="balance-sheet-liabilities" />
        ) : (
          <EmptyState title="لا التزامات حتى هذا التاريخ" />
        )}
      </Card>

      <Card title={`حقوق المالك — ${egp(bs.equityTotal)}`} subtitle={`منها مسحوبات المالك: ${egp(bs.drawingsTotal)}`}>
        {bs.equity.length ? (
          <FilterableTable columns={sectionColumns} rows={toRows(bs.equity)} ariaLabel="حقوق المالك" exportFilename="balance-sheet-equity" />
        ) : (
          <EmptyState title="لا حقوق مالك حتى هذا التاريخ" />
        )}
        <p className="mt-3 text-sm" style={mutedStyle}>
          حقوق المالك {egp(bs.equityTotal)} + صافي الربح للفترة {egp(bs.netIncome)} = {egp(bs.totalEquityInclIncome)}
        </p>
      </Card>

      <Card title="التحقق المحاسبي">
        <p style={mutedStyle}>
          الموارد {egp(bs.assetsTotal)} = الالتزامات + حقوق المالك + صافي الربح {egp(bs.liabilitiesPlusEquity)} —{" "}
          {bs.balanced ? "القائمة متوازنة ✓" : "غير متوازنة ✗"}
        </p>
      </Card>
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
