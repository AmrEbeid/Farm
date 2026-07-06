import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { EXPENSE_KIND_AR, REQUEST_STATUS_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";

type CustodyHolderReportRow = {
  custody_account_id: string;
  holder_label: string;
  target_float: number;
  active: boolean;
  opening_balance: number;
  amount_in: number;
  amount_out: number;
  closing_balance: number;
  movements_count: number;
};

type CustodyMovementReportRow = {
  id: string;
  custody_account_id: string;
  holder_label: string;
  occurred_at: string;
  movement_type: string;
  amount_in: number;
  amount_out: number;
  net: number;
  expense_id: string | null;
  payment_request_id: string | null;
  transfer_group_id: string | null;
  note: string | null;
};

type CustodyLedgerReport = {
  period_start: string;
  period_end: string;
  holders: CustodyHolderReportRow[];
  movements: CustodyMovementReportRow[];
};

type CashExpenseReportRow = {
  expense_id: string;
  expense_date: string;
  category: string | null;
  description: string | null;
  total: number;
  kind: string;
  paid_by: string | null;
  custody_movement_id: string | null;
  paid_at: string | null;
  holder_label: string | null;
  payment_request_id: string | null;
  missing_movement: boolean;
};

type CashExpenseReport = {
  total_amount: number;
  missing_movement_count: number;
  rows: CashExpenseReportRow[];
};

type UnpaidObligationReportRow = {
  expense_id: string;
  expense_date: string;
  category: string | null;
  description: string | null;
  total: number;
  kind: string;
  age_days: number;
  aging_bucket: string;
  payment_request_id: string | null;
  request_no: number | null;
  request_status: string | null;
};

type UnpaidObligationReport = {
  as_of: string;
  total_amount: number;
  over_30_amount: number;
  over_30_count: number;
  rows: UnpaidObligationReportRow[];
};

type OwnerFundingReportRow = {
  funding_id: string;
  payment_request_id: string;
  request_no: number;
  request_status: string;
  request_period_start: string | null;
  request_period_end: string | null;
  holder_label: string;
  occurred_at: string;
  amount: number;
  note: string | null;
  approved_net_request: number;
  owner_funding_received: number;
  remaining_to_fund: number;
};

type OwnerFundingReport = {
  total_funding: number;
  rows: OwnerFundingReportRow[];
};

export default async function FinanceCustodyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; asOf?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  const defaultEnd = isoDate(today);
  const generatedOn = isoDate(today);
  const start = parseDateParam(params.start, defaultStart);
  const end = parseDateParam(params.end, defaultEnd);
  const asOf = parseDateParam(params.asOf, end);

  const [ledgerRes, cashRes, obligationsRes, fundingRes] = await Promise.all([
    sb.rpc("fn_custody_ledger_report", { p_org: m.orgId, p_period_start: start, p_period_end: end }),
    sb.rpc("fn_custody_cash_expense_report", { p_org: m.orgId, p_period_start: start, p_period_end: end }),
    sb.rpc("fn_unpaid_obligations_report", { p_org: m.orgId, p_as_of: asOf }),
    sb.rpc("fn_owner_funding_report", { p_org: m.orgId, p_period_start: start, p_period_end: end }),
  ]);
  if (ledgerRes.error) throw ledgerRes.error;
  if (cashRes.error) throw cashRes.error;
  if (obligationsRes.error) throw obligationsRes.error;
  if (fundingRes.error) throw fundingRes.error;

  const ledger = (ledgerRes.data ?? { holders: [], movements: [] }) as CustodyLedgerReport;
  const cash = (cashRes.data ?? { total_amount: 0, missing_movement_count: 0, rows: [] }) as CashExpenseReport;
  const obligations = (obligationsRes.data ?? { total_amount: 0, over_30_amount: 0, over_30_count: 0, rows: [] }) as UnpaidObligationReport;
  const funding = (fundingRes.data ?? { total_funding: 0, rows: [] }) as OwnerFundingReport;

  const openingTotal = ledger.holders.reduce((sum, row) => sum + Number(row.opening_balance ?? 0), 0);
  const closingTotal = ledger.holders.reduce((sum, row) => sum + Number(row.closing_balance ?? 0), 0);
  const periodIn = ledger.holders.reduce((sum, row) => sum + Number(row.amount_in ?? 0), 0);
  const periodOut = ledger.holders.reduce((sum, row) => sum + Number(row.amount_out ?? 0), 0);
  const printSummary = [
    { id: "period", label: "فترة التقرير", value: `${fmtDate(start)} → ${fmtDate(end)}` },
    { id: "as-of", label: "تاريخ أعمار الالتزامات", value: fmtDate(asOf) },
    { id: "generated", label: "تاريخ الإصدار", value: fmtDate(generatedOn) },
    { id: "source", label: "المصدر", value: "العهدة، المصروفات، طلبات الصرف، وتمويل المالك" },
  ];

  const holderRows: SimpleRow[] = ledger.holders.map((row) => ({
    id: row.custody_account_id,
    holder: row.holder_label,
    opening: Number(row.opening_balance ?? 0),
    in: Number(row.amount_in ?? 0),
    out: Number(row.amount_out ?? 0),
    closing: Number(row.closing_balance ?? 0),
    target: Number(row.target_float ?? 0),
    movements: Number(row.movements_count ?? 0),
    status: row.active ? "نشط" : "مؤرشف",
  }));

  const movementRows: SimpleRow[] = ledger.movements.map((row) => ({
    id: row.id,
    date: fmtDate(row.occurred_at),
    holder: row.holder_label,
    type: row.movement_type,
    in: Number(row.amount_in ?? 0),
    out: Number(row.amount_out ?? 0),
    net: Number(row.net ?? 0),
    request: row.payment_request_id ? "طلب صرف" : "—",
    request_href: row.payment_request_id ? `/custody/request/${row.payment_request_id}` : undefined,
    expense: row.expense_id ? "مصروف" : "—",
    expense_href: row.expense_id ? `/expenses/${row.expense_id}` : undefined,
    note: row.note ?? "—",
  }));

  const cashRows: SimpleRow[] = cash.rows.map((row) => ({
    id: row.expense_id,
    href: `/expenses/${row.expense_id}`,
    date: fmtDate(row.paid_at ?? row.expense_date),
    holder: row.holder_label ?? "حركة غير مربوطة",
    category: row.category ?? "غير مصنف",
    description: row.description ?? "—",
    kind: EXPENSE_KIND_AR[row.kind] ?? row.kind,
    amount: Number(row.total ?? 0),
    request: row.payment_request_id ? "طلب صرف" : "—",
    request_href: row.payment_request_id ? `/custody/request/${row.payment_request_id}` : undefined,
    movement: row.missing_movement ? "مراجعة" : "مكتملة",
  }));

  const obligationRows: SimpleRow[] = obligations.rows.map((row) => ({
    id: row.expense_id,
    href: `/expenses/${row.expense_id}`,
    date: fmtDate(row.expense_date),
    category: row.category ?? "غير مصنف",
    description: row.description ?? "—",
    kind: EXPENSE_KIND_AR[row.kind] ?? row.kind,
    amount: Number(row.total ?? 0),
    age: Number(row.age_days ?? 0),
    bucket: row.aging_bucket,
    request: row.request_no ? `طلب ${num(row.request_no)}` : "غير مضاف",
    request_href: row.payment_request_id ? `/custody/request/${row.payment_request_id}` : undefined,
    status: row.request_status ? REQUEST_STATUS_AR[row.request_status] ?? row.request_status : "غير مضاف",
  }));

  const fundingRows: SimpleRow[] = funding.rows.map((row) => ({
    id: row.funding_id,
    request: `طلب ${num(row.request_no)}`,
    request_href: `/custody/request/${row.payment_request_id}`,
    status: REQUEST_STATUS_AR[row.request_status] ?? row.request_status,
    holder: row.holder_label,
    date: fmtDate(row.occurred_at),
    amount: Number(row.amount ?? 0),
    approved: Number(row.approved_net_request ?? 0),
    received: Number(row.owner_funding_received ?? 0),
    remaining: Number(row.remaining_to_fund ?? 0),
    period: formatPeriod(row.request_period_start, row.request_period_end),
    note: row.note ?? "—",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">تقارير العهدة والصرف</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            كشف شهري عملي للعهدة، المصروفات النقدية، الالتزامات الآجلة، وتمويل المالك.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة التقرير" />
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
          <HeaderLink href="/custody">العهدة وطلبات الصرف</HeaderLink>
          <HeaderLink href="/accounting">المحاسبة</HeaderLink>
        </div>
      </header>

      <section className="print-only">
        <Card title="هوية تقرير العهدة والصرف">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {printSummary.map((item) => (
              <div
                key={item.id}
                className="rounded-md border p-3"
                style={{ borderColor: "var(--line)", background: "var(--surface)" }}
              >
                <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  {item.label}
                </div>
                <div className="mt-1 text-sm font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>

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
          <label className="flex flex-col gap-1 text-sm font-semibold">
            تاريخ أعمار الالتزامات
            <input name="asOf" type="date" defaultValue={asOf} className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-semibold"
              style={{ color: "white", background: "var(--brand)" }}
            >
              تحديث التقرير
            </button>
          </div>
        </form>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="افتتاحي العهدة" value={egp(openingTotal)} />
        <KpiCard label="وارد الفترة" value={egp(periodIn)} />
        <KpiCard label="صادر الفترة" value={egp(periodOut)} />
        <KpiCard label="ختامي العهدة" value={egp(closingTotal)} />
        <KpiCard label="مصروفات نقدية" value={egp(cash.total_amount)} />
        <KpiCard label="التزامات ٣٠+ يوم" value={egp(obligations.over_30_amount)} deltaDirection={obligations.over_30_amount > 0 ? "down" : "none"} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <KpiCard label="إجمالي الالتزامات الآجلة" value={egp(obligations.total_amount)} />
        <KpiCard label="عدد التزامات ٣٠+ يوم" value={num(obligations.over_30_count)} deltaDirection={obligations.over_30_count > 0 ? "down" : "none"} />
        <KpiCard label="تمويل المالك المستلم" value={egp(funding.total_funding)} />
      </section>

      <Card title="العهدة حسب الشخص">
        {holderRows.length ? (
          <FilterableTable
            columns={holderColumns}
            rows={holderRows}
            ariaLabel="العهدة حسب الشخص"
            exportFilename={`custody-holders-${start}-to-${end}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد حسابات عهدة بعد" />
        )}
      </Card>

      <Card title="سجل حركات العهدة في الفترة">
        {movementRows.length ? (
          <FilterableTable
            columns={movementColumns}
            rows={movementRows}
            ariaLabel="سجل حركات العهدة في الفترة"
            exportFilename={`custody-ledger-${start}-to-${end}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد حركات عهدة في الفترة" />
        )}
      </Card>

      <Card title="مصروفات مدفوعة من العهدة">
        {cashRows.length ? (
          <FilterableTable
            columns={cashColumns}
            rows={cashRows}
            ariaLabel="مصروفات مدفوعة من العهدة"
            exportFilename={`custody-cash-expenses-${start}-to-${end}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد مصروفات مدفوعة من العهدة في الفترة" />
        )}
      </Card>

      <Card title="التزامات آجلة غير مدفوعة">
        {obligationRows.length ? (
          <FilterableTable
            columns={obligationColumns}
            rows={obligationRows}
            ariaLabel="التزامات آجلة غير مدفوعة"
            exportFilename={`unpaid-obligations-${asOf}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد التزامات آجلة غير مدفوعة" />
        )}
      </Card>

      <Card title="تمويل المالك والتغذية">
        {fundingRows.length ? (
          <FilterableTable
            columns={fundingColumns}
            rows={fundingRows}
            ariaLabel="تمويل المالك والتغذية"
            exportFilename={`owner-funding-${start}-to-${end}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا يوجد تمويل مالك مسجل في الفترة" />
        )}
      </Card>

      {cash.missing_movement_count > 0 && (
        <Card title="بنود تحتاج مراجعة">
          <p style={{ color: "var(--ink-muted)" }}>
            يوجد {num(cash.missing_movement_count)} مصروف مدفوع من العهدة بدون حركة عهدة مربوطة. راجع مسار المصروف قبل إصدار تقرير نهائي.
          </p>
        </Card>
      )}
    </div>
  );
}

const holderColumns: SimpleColumn[] = [
  { id: "holder", header: "صاحب العهدة" },
  { id: "opening", header: "افتتاحي", kind: "money", numeric: true },
  { id: "in", header: "وارد", kind: "money", numeric: true },
  { id: "out", header: "صادر", kind: "money", numeric: true },
  { id: "closing", header: "ختامي", kind: "money", numeric: true },
  { id: "target", header: "المستهدف", kind: "money", numeric: true },
  { id: "movements", header: "حركات", kind: "num", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];

const movementColumns: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "holder", header: "صاحب العهدة" },
  { id: "type", header: "نوع الحركة" },
  { id: "in", header: "وارد", kind: "money", numeric: true },
  { id: "out", header: "صادر", kind: "money", numeric: true },
  { id: "net", header: "الصافي", kind: "money", numeric: true },
  { id: "request", header: "طلب الصرف", kind: "link" },
  { id: "expense", header: "المصروف", kind: "link" },
  { id: "note", header: "ملاحظات" },
];

const cashColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ السداد" },
  { id: "holder", header: "من عهدة" },
  { id: "category", header: "البند" },
  { id: "description", header: "الوصف" },
  { id: "kind", header: "النوع", kind: "status" },
  { id: "amount", header: "المبلغ", kind: "money", numeric: true },
  { id: "request", header: "طلب الصرف", kind: "link" },
  { id: "movement", header: "الحركة", kind: "status" },
];

const obligationColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ المصروف" },
  { id: "category", header: "البند" },
  { id: "description", header: "الوصف" },
  { id: "kind", header: "النوع", kind: "status" },
  { id: "amount", header: "المبلغ", kind: "money", numeric: true },
  { id: "age", header: "العمر بالأيام", kind: "num", numeric: true },
  { id: "bucket", header: "فئة العمر", kind: "status" },
  { id: "request", header: "طلب الصرف", kind: "link" },
  { id: "status", header: "حالة الطلب", kind: "status" },
];

const fundingColumns: SimpleColumn[] = [
  { id: "request", header: "طلب الصرف", kind: "link" },
  { id: "status", header: "الحالة", kind: "status" },
  { id: "holder", header: "أُودع في عهدة" },
  { id: "date", header: "تاريخ الاستلام" },
  { id: "amount", header: "المبلغ المستلم", kind: "money", numeric: true },
  { id: "approved", header: "المعتمد", kind: "money", numeric: true },
  { id: "received", header: "المستلم للطلب", kind: "money", numeric: true },
  { id: "remaining", header: "المتبقي", kind: "money", numeric: true },
  { id: "period", header: "فترة الطلب" },
  { id: "note", header: "ملاحظات" },
];

const inputStyle = {
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
};

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

function parseDateParam(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${start ? fmtDate(start) : "…"} → ${end ? fmtDate(end) : "…"}`;
}
