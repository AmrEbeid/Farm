import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { CustodyForms } from "@/components/CustodyForms";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";

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

export default async function CustodyDashboardPage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const [accountsRes, movementsRes, requestsRes, unpaidRes] = await Promise.all([
    sb.from("custody_accounts").select("id, holder_label, target_float, active").order("holder_label"),
    sb
      .from("custody_movements")
      .select("id, occurred_at, movement_type, amount_in, amount_out, custody_account_id, note")
      .order("occurred_at", { ascending: false })
      .limit(15),
    sb
      .from("payment_requests")
      .select("id, request_no, status, period_start, period_end, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
    sb.from("expenses").select("total").eq("payment_status", "post_paid_unpaid").eq("kind", "operating"),
  ]);
  if (accountsRes.error) throw accountsRes.error;
  if (movementsRes.error) throw movementsRes.error;
  if (requestsRes.error) throw requestsRes.error;
  if (unpaidRes.error) throw unpaidRes.error;

  // current balance per account (derived, via the gated read RPC) — runs in parallel.
  const acctList = accountsRes.data ?? [];
  const balances = await Promise.all(
    acctList.map(async (a) => {
      const { data, error } = await sb.rpc("fn_custody_balance", { p_account: a.id });
      if (error) throw error;
      return Number(data ?? 0);
    }),
  );
  const byId = new Map(acctList.map((a, i) => [a.id, { ...a, balance: balances[i] }]));

  const totalBalance = balances.reduce((s, b) => s + b, 0);
  const totalTarget = acctList.reduce((s, a) => s + Number(a.target_float ?? 0), 0);
  const totalTopUp = acctList.reduce((s, a, i) => s + Math.max(0, Number(a.target_float ?? 0) - balances[i]), 0);
  const unpaidPostPaid = (unpaidRes.data ?? []).reduce((s, e) => s + Number(e.total ?? 0), 0);
  const netRequest = unpaidPostPaid + totalTopUp;

  const acctCols: SimpleColumn[] = [
    { id: "holder", header: "العهدة لدى" },
    { id: "balance", header: "الرصيد الحالي", numeric: true },
    { id: "target", header: "المستهدف", numeric: true },
    { id: "topup", header: "التغذية المطلوبة", numeric: true },
  ];
  const acctRows = acctList.map((a, i) => ({
    id: a.id,
    holder: a.holder_label,
    balance: egp(balances[i]),
    target: egp(Number(a.target_float ?? 0)),
    topup: egp(Math.max(0, Number(a.target_float ?? 0) - balances[i])),
  }));

  const moveCols: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "holder", header: "العهدة لدى" },
    { id: "type", header: "نوع الحركة" },
    { id: "in", header: "وارد", numeric: true },
    { id: "out", header: "صادر", numeric: true },
  ];
  const moveRows = (movementsRes.data ?? []).map((m) => ({
    id: m.id,
    date: fmtDate(m.occurred_at),
    holder: byId.get(m.custody_account_id)?.holder_label ?? "—",
    type: m.movement_type,
    in: Number(m.amount_in) > 0 ? egp(Number(m.amount_in)) : "—",
    out: Number(m.amount_out) > 0 ? egp(Number(m.amount_out)) : "—",
  }));

  const reqCols: SimpleColumn[] = [
    { id: "no", header: "رقم الطلب", numeric: true },
    { id: "status", header: "الحالة" },
    { id: "period", header: "الفترة" },
    { id: "created", header: "أُنشئ في" },
  ];
  const reqRows = (requestsRes.data ?? []).map((r) => ({
    id: r.id,
    href: `/custody/request/${r.id}`,
    no: num(r.request_no),
    status: REQ_STATUS_AR[r.status] ?? r.status,
    period: r.period_start ? `${fmtDate(r.period_start)} → ${r.period_end ? fmtDate(r.period_end) : "…"}` : "—",
    created: fmtDate(r.created_at),
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">العهدة وطلبات الصرف</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          رصيد العهدة النقدية والمطلوب من المالك — محدّث لحظيًا من سجل العهدة والمصروفات.
        </p>
      </header>

      <CustodyForms accounts={acctList.map((a) => ({ id: a.id, holder_label: a.holder_label }))} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="الرصيد الحالي للعهدة" value={egp(totalBalance)} />
        <KpiCard label="العهدة المستهدفة" value={egp(totalTarget)} />
        <KpiCard label="التغذية المطلوبة" value={egp(totalTopUp)} />
        <KpiCard label="آجل غير مدفوع" value={egp(unpaidPostPaid)} />
        <KpiCard label="صافي المطلوب من المالك" value={egp(netRequest)} />
      </div>

      <Card title="حسابات العهدة">
        {acctRows.length ? (
          <SimpleTable columns={acctCols} rows={acctRows} empty="لا توجد حسابات عهدة بعد" />
        ) : (
          <EmptyState title="لا توجد حسابات عهدة بعد" />
        )}
      </Card>

      <Card title="آخر حركات العهدة">
        <SimpleTable columns={moveCols} rows={moveRows} empty="لا توجد حركات بعد" />
      </Card>

      <Card title="طلبات الصرف">
        <SimpleTable columns={reqCols} rows={reqRows} empty="لا توجد طلبات صرف بعد" />
      </Card>
    </div>
  );
}
