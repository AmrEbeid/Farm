import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { RequestLifecycle } from "@/components/RequestLifecycle";
import { AddExpenseToPaymentRequest } from "@/components/CustodyForms";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";

// SPEC-0018 slice 5 — the printable monthly «إذن صرف» + lifecycle. Renders live from the RLS-scoped
// request/lines/expenses + fn_payment_request_totals. Finance-gated; print via the toolbar button.
const REQ_STATUS_AR: Record<string, string> = {
  draft: "مسودة", submitted: "مُرسل", approved_operational: "اعتماد تشغيلي",
  approved_final: "اعتماد نهائي", paid: "مدفوع", closed: "مُقفل",
};

type Totals = {
  post_paid_unpaid?: number; target_float?: number; current_custody?: number;
  custody_top_up?: number; net_request?: number;
};

export default async function PaymentRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const { data: req, error: reqError } = await sb
    .from("payment_requests")
    .select("id, request_no, status, period_start, period_end, custody_account_id, note")
    .eq("id", requestId)
    .maybeSingle();
  if (reqError) throw reqError;

  if (!req) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Link href="/custody" className="text-sm" style={{ color: "var(--ink-muted)" }}>→ العودة للعهدة</Link>
        <EmptyState title="طلب الصرف غير موجود" />
      </div>
    );
  }

  const [linesRes, totalsRes, orgRes] = await Promise.all([
    sb.from("payment_request_lines").select("expense_id").eq("payment_request_id", requestId),
    sb.rpc("fn_payment_request_totals", { p_request: requestId }),
    sb.from("organization").select("name").eq("id", m.orgId).maybeSingle(),
  ]);
  if (linesRes.error) throw linesRes.error;
  if (totalsRes.error) throw totalsRes.error;
  if (orgRes.error) throw orgRes.error;

  const ids = (linesRes.data ?? []).map((l) => l.expense_id);
  const [expensesRes, acctRes, availableExpensesRes] = await Promise.all([
    ids.length
      ? sb.from("expenses").select("id, description, category, total, payment_status").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; description: string | null; category: string | null; total: number | null; payment_status: string | null }[], error: null }),
    req.custody_account_id
      ? sb.from("custody_accounts").select("holder_label").eq("id", req.custody_account_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    req.status === "draft"
      ? sb
          .from("expenses")
          .select("id, description, category, total")
          .eq("payment_status", "post_paid_unpaid")
          .eq("kind", "operating")
          .order("date", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] as { id: string; description: string | null; category: string | null; total: number | null }[], error: null }),
  ]);
  if (expensesRes.error) throw expensesRes.error;
  if (acctRes.error) throw acctRes.error;
  if (availableExpensesRes.error) throw availableExpensesRes.error;

  const t: Totals = (totalsRes.data as Totals) ?? {};
  const exp = expensesRes.data ?? [];
  const linkedExpenseIds = new Set(ids);
  const availableExpenseOptions = (availableExpensesRes.data ?? [])
    .filter((e) => !linkedExpenseIds.has(e.id))
    .map((e) => ({
      id: e.id,
      label: `${e.description ?? e.category ?? "مصروف"} — ${egp(Number(e.total ?? 0))}`,
    }));

  // Request math only includes operating post-paid expenses; custody-paid expenses live in the custody ledger.
  const cats = new Map<string, { unpaid: number }>();
  for (const e of exp) {
    const k = e.category ?? "أخرى";
    const row = cats.get(k) ?? { unpaid: 0 };
    if (e.payment_status === "post_paid_unpaid") row.unpaid += Number(e.total ?? 0);
    cats.set(k, row);
  }
  const catCols: SimpleColumn[] = [
    { id: "cat", header: "الفئة" },
    { id: "unpaid", header: "آجل مطلوب", numeric: true },
  ];
  const catRows = [...cats.entries()].map(([cat, v], i) => ({
    id: String(i), cat, unpaid: egp(v.unpaid),
  }));

  const lineCols: SimpleColumn[] = [
    { id: "desc", header: "البيان" },
    { id: "cat", header: "الفئة" },
    { id: "status", header: "حالة الاحتساب" },
    { id: "total", header: "الإجمالي", numeric: true },
  ];
  const lineRows = exp.map((e) => ({
    id: e.id, desc: e.description ?? "—", cat: e.category ?? "—",
    status: e.payment_status === "post_paid_unpaid" ? "آجل محسوب" : "غير محسوب في الطلب",
    total: egp(Number(e.total ?? 0)),
  }));

  return (
    <div className="flex flex-col gap-5 p-6">
      <Link href="/custody" className="text-sm no-print" style={{ color: "var(--ink-muted)" }}>→ العودة للعهدة</Link>

      <header className="text-center">
        <h1 className="text-2xl font-bold">{orgRes.data?.name ?? "مزارع عبيد"}</h1>
        <p className="text-lg font-semibold">
          إذن صرف رقم {num(req.request_no)} — {REQ_STATUS_AR[req.status] ?? req.status}
        </p>
        {req.period_start && (
          <p style={{ color: "var(--ink-muted)" }}>
            الفترة: {fmtDate(req.period_start)} → {req.period_end ? fmtDate(req.period_end) : "…"}
            {acctRes.data ? ` — العهدة: ${acctRes.data.holder_label}` : ""}
          </p>
        )}
      </header>

      <RequestLifecycle requestId={req.id} status={req.status} role={m.role} />

      {req.status === "draft" && (
        <Card title="إضافة مصروف آجل للطلب">
          <AddExpenseToPaymentRequest requestId={req.id} expenses={availableExpenseOptions} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card title="آجل غير مدفوع"><p className="text-xl font-bold">{egp(t.post_paid_unpaid ?? 0)}</p></Card>
        <Card title="التغذية المطلوبة"><p className="text-xl font-bold">{egp(t.custody_top_up ?? 0)}</p></Card>
        <Card title="الرصيد الحالي للعهدة"><p className="text-xl font-bold">{egp(t.current_custody ?? 0)}</p></Card>
        <Card title="صافي المطلوب من المالك"><p className="text-xl font-bold" style={{ color: "var(--brand)" }}>{egp(t.net_request ?? 0)}</p></Card>
      </div>

      <Card title="الملخص حسب الفئة">
        <SimpleTable columns={catCols} rows={catRows} empty="لا توجد بنود بعد" />
      </Card>
      <Card title="البنود التفصيلية">
        <SimpleTable columns={lineCols} rows={lineRows} empty="لم تُضف بنود لهذا الطلب بعد" />
      </Card>

      <div className="grid grid-cols-3 gap-6 pt-8 text-center text-sm">
        <div>المحاسب<br /><br />التوقيع: ...........</div>
        <div>مدير المزرعة<br /><br />التوقيع: ...........</div>
        <div>المالك<br /><br />التوقيع: ...........</div>
      </div>
    </div>
  );
}
