import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PrintButton } from "@/components/print-button";
import { CustodyForms } from "@/components/CustodyForms";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { compareDecimals, egpExact, maxDecimal, subtractDecimals, sumDecimals } from "@/lib/decimal";
import {
  assertFinanceUnpaidSummary,
  currentMonthBounds,
  unpaidKnownTotal,
  unpaidUnknownCount,
} from "@/lib/expense-register-summary";
import {
  parseCustodyDailySnapshot,
  type CustodyRequestFilter,
} from "@/lib/custody-daily-snapshot";

// SPEC-0018 «العهدة وطلبات الصرف» — module dashboard + write surface (slices 3+4). Custody balance + the
// live owner payment-request figures, derived from the RLS-scoped custody/expense/request tables; write actions
// (account, movement, request) are gated via SECURITY DEFINER RPCs.
const REQ_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مُرسل",
  approved_operational: "اعتماد تشغيلي",
  approved_final: "اعتماد نهائي",
  paid: "مدفوع",
  closed: "مُقفل",
};

function parseRequestFilter(raw: string | undefined): CustodyRequestFilter {
  return raw === "awaiting" || raw === "settled" ? raw : "all";
}

const MOVEMENT_DISPLAY_CAP = 15;
const REQUEST_DISPLAY_CAP = 200;

export default async function CustodyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ requests?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const requestFilter = parseRequestFilter((await searchParams).requests);
  const monthBounds = currentMonthBounds();
  const snapshotRes = await sb.rpc("fn_custody_daily_snapshot", {
    p_org: m.orgId,
    p_request_filter: requestFilter,
    p_month_start: monthBounds.start,
    p_month_end: monthBounds.end,
    p_movement_limit: MOVEMENT_DISPLAY_CAP,
    p_request_limit: REQUEST_DISPLAY_CAP,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseCustodyDailySnapshot(snapshotRes.data);
  if (snapshot.orgId !== m.orgId || snapshot.requestFilter !== requestFilter) {
    throw new Error("custody daily snapshot: response scope does not match the request");
  }
  const expenseSummary = snapshot.expenseSummary;
  assertFinanceUnpaidSummary(expenseSummary);

  const acctList = snapshot.accountRows;
  const topUps = acctList.map((account) => maxDecimal(subtractDecimals(account.targetFloat, account.balance), "0"));

  const totalBalance = sumDecimals(acctList.map((account) => account.balance)).total;
  const totalTarget = sumDecimals(acctList.map((account) => account.targetFloat)).total;
  const totalTopUp = sumDecimals(topUps).total;
  const unpaidOperating = expenseSummary.unpaidOperatingTotal;
  const unpaidCapex = expenseSummary.unpaidCapexTotal;
  const unpaidDrawing = expenseSummary.unpaidDrawingTotal;
  const unpaidPostPaid = unpaidKnownTotal(expenseSummary);
  const unpaidUnknown = unpaidUnknownCount(expenseSummary);
  const netRequest = sumDecimals([unpaidPostPaid, totalTopUp]).total;

  const acctCols: SimpleColumn[] = [
    { id: "holder", header: "العهدة لدى" },
    { id: "balance", header: "الرصيد الحالي", numeric: true },
    { id: "target", header: "المستهدف", numeric: true },
    { id: "topup", header: "التغذية المطلوبة", numeric: true },
  ];
  const acctRows = acctList.map((a, i) => ({
    id: a.id,
    holder: a.holderLabel,
    balance: egpExact(a.balance),
    target: egpExact(a.targetFloat),
    topup: egpExact(topUps[i]),
  }));

  const moveCols: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "holder", header: "العهدة لدى" },
    { id: "type", header: "نوع الحركة" },
    { id: "in", header: "وارد", numeric: true },
    { id: "out", header: "صادر", numeric: true },
  ];
  const moveRows = snapshot.movementRows.map((m) => ({
    id: m.id,
    href: `/custody/movements/${m.id}`,
    date: fmtDate(m.occurredAt),
    holder: m.holderLabel,
    type: m.reversalOf ? `↩ ${m.movementType}` : m.reversedBy ? `${m.movementType} — معكوسة` : m.movementType,
    in: compareDecimals(m.amountIn, "0") > 0 ? egpExact(m.amountIn) : "—",
    out: compareDecimals(m.amountOut, "0") > 0 ? egpExact(m.amountOut) : "—",
  }));

  const allRequests = snapshot.requestRows;
  const allRequestCount = snapshot.allRequestCount;
  const awaitingRequestCount = snapshot.awaitingRequestCount;
  const settledRequestCount = snapshot.settledRequestCount;
  const selectedRequestCount = snapshot.selectedRequestCount;
  const requestsTruncated = selectedRequestCount > allRequests.length;
  const requestChips: { key: CustodyRequestFilter; label: string; value: number; danger?: boolean }[] = [
    { key: "all", label: "كل طلبات الصرف", value: allRequestCount },
    {
      key: "awaiting",
      label: "بانتظار إجراء",
      value: awaitingRequestCount,
      danger: true,
    },
    { key: "settled", label: "مدفوعة/مقفلة", value: settledRequestCount },
  ];

  const reqCols: SimpleColumn[] = [
    { id: "no", header: "رقم الطلب", numeric: true },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "period", header: "الفترة" },
    { id: "created", header: "أُنشئ في" },
  ];
  const reqRows = allRequests.map((r) => ({
      id: r.id,
      href: `/custody/request/${r.id}`,
      no: num(r.requestNo),
      status: REQ_STATUS_AR[r.status] ?? r.status,
      period: r.periodStart ? `${fmtDate(r.periodStart)} → ${r.periodEnd ? fmtDate(r.periodEnd) : "…"}` : "—",
      created: fmtDate(r.createdAt),
    }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">العهدة وطلبات الصرف</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            رصيد العهدة النقدية والمطلوب من المالك — محدّث لحظيًا من سجل العهدة والمصروفات.
          </p>
        </div>
        <PrintButton label="طباعة العهدة" />
      </header>

      <div className="no-print">
        <CustodyForms accounts={acctList.map((a) => ({ id: a.id, holder_label: a.holderLabel }))} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7">
        <KpiCard label="الرصيد الحالي للعهدة" value={egpExact(totalBalance)} />
        <KpiCard label="العهدة المستهدفة" value={egpExact(totalTarget)} />
        <KpiCard label="التغذية المطلوبة" value={egpExact(totalTopUp)} />
        <KpiCard label="آجل تشغيلي" value={egpExact(unpaidOperating)} />
        <KpiCard label="آجل رأسمالي" value={egpExact(unpaidCapex)} />
        <KpiCard label="آجل مسحوبات" value={egpExact(unpaidDrawing)} />
        <KpiCard
          label={unpaidUnknown > 0 ? "صافي المطلوب المعروف" : "صافي المطلوب من المالك"}
          value={egpExact(netRequest)}
        />
      </div>
      {unpaidUnknown > 0 && (
        <Alert
          tone="warning"
          title="مبالغ آجلة غير مكتملة"
          description={`يوجد ${num(unpaidUnknown)} مصروف آجل بدون مبلغ. الأرقام أعلاه تجمع المبالغ المعروفة فقط حتى تُستكمل هذه السجلات.`}
        />
      )}

      <Card title="حسابات العهدة">
        {acctRows.length ? (
          <SimpleTable columns={acctCols} rows={acctRows} ariaLabel="حسابات العهدة" empty="لا توجد حسابات عهدة بعد" />
        ) : (
          <EmptyState title="لا توجد حسابات عهدة بعد" />
        )}
      </Card>

      <Card title="آخر حركات العهدة">
        {snapshot.movementCount > moveRows.length && (
          <p className="mb-3 text-sm" style={{ color: "var(--ink-muted)" }}>
            تعرض القائمة أحدث {num(moveRows.length)} من أصل {num(snapshot.movementCount)} حركة عهدة.
          </p>
        )}
        <SimpleTable columns={moveCols} rows={moveRows} ariaLabel="آخر حركات العهدة" empty="لا توجد حركات بعد" />
      </Card>

      <Card title="طلبات الصرف">
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          {requestChips.map((chip) => (
            <DashboardKpiLink
              key={chip.key}
              href={chip.key === "all" ? "/custody" : `/custody?requests=${chip.key}`}
              active={requestFilter === chip.key}
            >
              <KpiCard
                label={chip.label}
                value={num(chip.value)}
                deltaDirection={chip.danger && chip.value > 0 ? "down" : "none"}
              />
            </DashboardKpiLink>
          ))}
        </div>
        {requestsTruncated && (
          <p className="mb-3 text-sm" style={{ color: "var(--ink-muted)" }}>
            القائمة تعرض أحدث {num(reqRows.length)} من أصل {num(selectedRequestCount)} طلبًا في الفلتر الحالي.
            البحث داخل المعروض، والتصدير متوقف حتى لا ينتج ملف ناقص.
          </p>
        )}
        <FilterableTable
          ariaLabel="طلبات الصرف"
          columns={reqCols}
          rows={reqRows}
          empty={requestFilter === "all" ? "لا توجد طلبات صرف بعد" : "لا طلبات مطابقة لهذا الفلتر"}
          searchColumns={["no", "status", "period"]}
          placeholder="ابحث في الطلبات…"
          exportFilename={requestsTruncated ? undefined : "payment-requests"}
        />
      </Card>
    </div>
  );
}
