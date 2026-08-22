import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { EXPENSE_KIND_AR, REQUEST_STATUS_AR } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";
import { egpDecimalSummary, egpExact, compareDecimals } from "@/lib/decimal";
import { parseCustodyReportsSnapshot } from "@/lib/custody reports snapshot";
import { cairoTodayIso, isCalendarDate } from "@/lib/payroll-close";

export default async function FinanceCustodyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const today = cairoTodayIso();
  const requestedEnd = params.end && isCalendarDate(params.end) && params.end <= today ? params.end : today;
  const defaultStart = `${requestedEnd.slice(0, 7)}-01`;
  const requestedStart = params.start && isCalendarDate(params.start) && params.start <= requestedEnd
    ? params.start
    : defaultStart;
  const start = requestedStart;
  const end = requestedEnd;
  const asOf = today;
  const generatedOn = today;

  const { data, error } = await sb.rpc("fn_custody_reports_snapshot", {
    p_org: m.orgId,
    p_period_start: start,
    p_period_end: end,
    p_as_of: asOf,
    p_row_limit: 400,
  });
  if (error) throw error;
  const snapshot = parseCustodyReportsSnapshot(data, m.orgId, start, end, asOf);
  const { summary } = snapshot;
  const printSummary = [
    { id: "period", label: "فترة التقرير", value: `${fmtDate(start)} → ${fmtDate(end)}` },
    { id: "as-of", label: "تاريخ أعمار الالتزامات", value: fmtDate(asOf) },
    { id: "generated", label: "تاريخ الإصدار", value: fmtDate(generatedOn) },
    { id: "source", label: "المصدر", value: "العهدة، المصروفات، طلبات الصرف، وتمويل المالك" },
  ];

  const holderRows: SimpleRow[] = snapshot.holders.map((row) => ({
    id: row.id,
    holder: row.holderLabel,
    opening: row.openingBalance,
    in: row.amountIn,
    out: row.amountOut,
    closing: row.closingBalance,
    target: row.targetFloat,
    movements: row.movementCount,
    status: row.active ? "نشط" : "مؤرشف",
  }));

  const movementRows: SimpleRow[] = snapshot.movements.map((row) => ({
    id: row.id,
    date: fmtDate(row.occurredAt),
    holder: row.holderLabel,
    type: row.movementType,
    in: row.amountIn,
    out: row.amountOut,
    net: row.net,
    request: row.paymentRequestId ? "طلب صرف" : "—",
    request_href: row.paymentRequestId ? `/custody/request/${row.paymentRequestId}` : undefined,
    expense: row.expenseId ? "مصروف" : "—",
    expense_href: row.expenseId ? `/expenses/${row.expenseId}` : undefined,
    note: row.note ?? "—",
  }));

  const cashRows: SimpleRow[] = snapshot.cashExpenses.map((row) => ({
    id: row.id,
    href: `/expenses/${row.id}`,
    date: fmtDate(row.paidAt ?? row.expenseDate),
    holder: row.holderLabel ?? "حركة غير مربوطة",
    category: row.category ?? "غير مصنف",
    description: row.description ?? "—",
    kind: EXPENSE_KIND_AR[row.kind] ?? row.kind,
    amount: row.total ?? undefined,
    request: row.paymentRequestId ? "طلب صرف" : "—",
    request_href: row.paymentRequestId ? `/custody/request/${row.paymentRequestId}` : undefined,
    movement: row.missingMovement ? "مراجعة" : "مكتملة",
  }));

  const obligationRows: SimpleRow[] = snapshot.obligations.map((row) => ({
    id: row.id,
    href: `/expenses/${row.id}`,
    date: row.expenseDate ? fmtDate(row.expenseDate) : "تاريخ غير مسجل",
    category: row.category ?? "غير مصنف",
    description: row.description ?? "—",
    kind: EXPENSE_KIND_AR[row.kind] ?? row.kind,
    amount: row.total ?? undefined,
    age: row.ageDays ?? "غير معروف",
    bucket: row.agingBucket === "unknown" ? "تاريخ غير مسجل" : row.agingBucket,
    request: row.requestNo !== null ? `طلب ${num(row.requestNo)}` : "غير مضاف",
    request_href: row.paymentRequestId ? `/custody/request/${row.paymentRequestId}` : undefined,
    status: row.requestStatus ? REQUEST_STATUS_AR[row.requestStatus] ?? row.requestStatus : "غير مضاف",
  }));

  const fundingRows: SimpleRow[] = snapshot.fundings.map((row) => ({
    id: row.id,
    request: `طلب ${num(row.requestNo)}`,
    request_href: `/custody/request/${row.paymentRequestId}`,
    status: REQUEST_STATUS_AR[row.requestStatus] ?? row.requestStatus,
    holder: row.holderLabel,
    date: fmtDate(row.occurredAt),
    amount: row.amount,
    approved: row.approvedNetRequest ?? undefined,
    received: row.ownerFundingReceived,
    remaining: row.remainingToFund,
    period: formatPeriod(row.requestPeriodStart, row.requestPeriodEnd),
    note: row.note ?? "—",
  }));

  const holderTruncated = summary.holderCount > snapshot.rowLimit;
  const movementTruncated = summary.movementCount > snapshot.rowLimit;
  const cashTruncated = summary.cashCount > snapshot.rowLimit;
  const obligationTruncated = summary.obligationCount > snapshot.rowLimit;
  const fundingTruncated = summary.fundingCount > snapshot.rowLimit;
  const anyTruncated = holderTruncated || movementTruncated || cashTruncated || obligationTruncated || fundingTruncated;

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
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" method="get">
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
              className="inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-semibold"
              style={{ color: "white", background: "var(--brand)" }}
            >
              تحديث التقرير
            </button>
          </div>
        </form>
      </Card>

      {anyTruncated && (
        <Card title="نطاق التفاصيل المعروضة">
          <p style={{ color: "var(--ink-muted)" }}>
            الإجماليات كاملة ودقيقة. يعرض كل جدول تفصيلي حتى {num(snapshot.rowLimit)} صف حسب ترتيب المتابعة، ويتوقف تصديره
            عندما يكون مختصرًا حتى لا يبدو الملف الجزئي تقريرًا كاملًا.
          </p>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="افتتاحي العهدة" value={egpExact(summary.openingTotal)} />
        <KpiCard label="وارد الفترة" value={egpExact(summary.periodIn)} />
        <KpiCard label="صادر الفترة" value={egpExact(summary.periodOut)} />
        <KpiCard label="ختامي العهدة" value={egpExact(summary.closingTotal)} />
        <KpiCard
          label="مصروفات نقدية"
          value={egpDecimalSummary({ total: summary.cashTotal, hasUnknown: summary.cashUnknownTotalCount > 0 })}
        />
        <KpiCard
          label="التزامات ٣٠+ يوم"
          value={egpDecimalSummary({ total: summary.over30Total, hasUnknown: summary.over30UnknownTotalCount > 0 })}
          deltaDirection={compareDecimals(summary.over30Total, "0") > 0 ? "down" : "none"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <KpiCard
          label="إجمالي الالتزامات الآجلة"
          value={egpDecimalSummary({ total: summary.obligationTotal, hasUnknown: summary.obligationUnknownTotalCount > 0 })}
        />
        <KpiCard label="عدد التزامات ٣٠+ يوم" value={num(summary.over30Count)} deltaDirection={summary.over30Count > 0 ? "down" : "none"} />
        <KpiCard label="تمويل المالك المستلم" value={egpExact(summary.fundingTotal)} />
      </section>

      <Card title="العهدة حسب الشخص">
        {holderRows.length ? (
          <FilterableTable
            columns={holderColumns}
            rows={holderRows}
            ariaLabel="العهدة حسب الشخص"
            exportFilename={holderTruncated ? undefined : `custody-holders-${start}-to-${end}.csv`}
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
            exportFilename={movementTruncated ? undefined : `custody-ledger-${start}-to-${end}.csv`}
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
            exportFilename={cashTruncated ? undefined : `custody-cash-expenses-${start}-to-${end}.csv`}
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
            exportFilename={obligationTruncated ? undefined : `unpaid-obligations-${asOf}.csv`}
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
            exportFilename={fundingTruncated ? undefined : `owner-funding-${start}-to-${end}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا يوجد تمويل مالك مسجل في الفترة" />
        )}
      </Card>

      {(summary.cashMissingMovementCount > 0 || summary.cashUnknownTotalCount > 0 || summary.obligationUnknownDateCount > 0) && (
        <Card title="بنود تحتاج مراجعة">
          <div className="flex flex-col gap-2" style={{ color: "var(--ink-muted)" }}>
            {summary.cashMissingMovementCount > 0 && (
              <p>يوجد {num(summary.cashMissingMovementCount)} مصروف مدفوع من العهدة بدون حركة عهدة مربوطة. راجع مسار المصروف قبل إصدار تقرير نهائي.</p>
            )}
            {summary.cashUnknownTotalCount > 0 && <p>يوجد {num(summary.cashUnknownTotalCount)} مصروف نقدي بلا مبلغ مسجل.</p>}
            {summary.obligationUnknownDateCount > 0 && <p>يوجد {num(summary.obligationUnknownDateCount)} التزام آجل بلا تاريخ مسجل، لذلك لا يدخل في أعمار ٣٠+ يوم.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

const holderColumns: SimpleColumn[] = [
  { id: "holder", header: "صاحب العهدة" },
  { id: "opening", header: "افتتاحي", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "in", header: "وارد", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "out", header: "صادر", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "closing", header: "ختامي", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "target", header: "المستهدف", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "movements", header: "حركات", kind: "num", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];

const movementColumns: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "holder", header: "صاحب العهدة" },
  { id: "type", header: "نوع الحركة" },
  { id: "in", header: "وارد", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "out", header: "صادر", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "net", header: "الصافي", kind: "money-preserve-exact", numeric: true, decimal: true },
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
  { id: "amount", header: "المبلغ", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "request", header: "طلب الصرف", kind: "link" },
  { id: "movement", header: "الحركة", kind: "status" },
];

const obligationColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ المصروف" },
  { id: "category", header: "البند" },
  { id: "description", header: "الوصف" },
  { id: "kind", header: "النوع", kind: "status" },
  { id: "amount", header: "المبلغ", kind: "money-preserve-exact", numeric: true, decimal: true },
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
  { id: "amount", header: "المبلغ المستلم", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "approved", header: "المعتمد", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "received", header: "المستلم للطلب", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "remaining", header: "المتبقي", kind: "money-preserve-exact", numeric: true, decimal: true },
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

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${start ? fmtDate(start) : "…"} → ${end ? fmtDate(end) : "…"}`;
}
