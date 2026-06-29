import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { RequestLifecycle } from "@/components/RequestLifecycle";
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
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();

  const { data: req } = await sb
    .from("payment_requests")
    .select("id, request_no, status, period_start, period_end, custody_account_id, note")
    .eq("id", requestId)
    .maybeSingle();

  if (!req) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Link href="/custody" className="text-sm" style={{ color: "var(--ink-muted)" }}>→ العودة للعهدة</Link>
        <EmptyState title="طلب الصرف غير موجود" />
      </div>
    );
  }

  const [{ data: lines }, totalsRes, { data: org }] = await Promise.all([
    sb.from("payment_request_lines").select("expense_id").eq("payment_request_id", requestId),
    sb.rpc("fn_payment_request_totals", { p_request: requestId }),
    sb.from("organization").select("name").maybeSingle(),
  ]);
  const ids = (lines ?? []).map((l) => l.expense_id);
  const { data: expenses } = ids.length
    ? await sb.from("expenses").select("id, description, category, total, payment_status").in("id", ids)
    : { data: [] as { id: string; description: string | null; category: string | null; total: number | null; payment_status: string | null }[] };
  const acct = req.custody_account_id
    ? (await sb.from("custody_accounts").select("holder_label").eq("id", req.custody_account_id).maybeSingle()).data
    : null;

  const t: Totals = (totalsRes.data as Totals) ?? {};
  const exp = expenses ?? [];

  // summary by category (آجل vs من العهدة)
  const cats = new Map<string, { unpaid: number; custody: number }>();
  for (const e of exp) {
    const k = e.category ?? "أخرى";
    const row = cats.get(k) ?? { unpaid: 0, custody: 0 };
    if (e.payment_status === "post_paid_unpaid") row.unpaid += Number(e.total ?? 0);
    else if (e.payment_status === "paid_from_custody") row.custody += Number(e.total ?? 0);
    cats.set(k, row);
  }
  const catCols: SimpleColumn[] = [
    { id: "cat", header: "الفئة" },
    { id: "unpaid", header: "آجل (غير مدفوع)", numeric: true },
    { id: "custody", header: "مدفوع من العهدة", numeric: true },
  ];
  const catRows = [...cats.entries()].map(([cat, v], i) => ({
    id: String(i), cat, unpaid: egp(v.unpaid), custody: egp(v.custody),
  }));

  const lineCols: SimpleColumn[] = [
    { id: "desc", header: "البيان" },
    { id: "cat", header: "الفئة" },
    { id: "status", header: "الحالة" },
    { id: "total", header: "الإجمالي", numeric: true },
  ];
  const lineRows = exp.map((e) => ({
    id: e.id, desc: e.description ?? "—", cat: e.category ?? "—",
    status: e.payment_status === "post_paid_unpaid" ? "آجل" : e.payment_status === "paid_from_custody" ? "من العهدة" : (e.payment_status ?? "—"),
    total: egp(Number(e.total ?? 0)),
  }));

  return (
    <div className="flex flex-col gap-5 p-6">
      <Link href="/custody" className="text-sm no-print" style={{ color: "var(--ink-muted)" }}>→ العودة للعهدة</Link>

      <header className="text-center">
        <h1 className="text-2xl font-bold">{org?.name ?? "مزارع عبيد"}</h1>
        <p className="text-lg font-semibold">
          إذن صرف رقم {num(req.request_no)} — {REQ_STATUS_AR[req.status] ?? req.status}
        </p>
        {req.period_start && (
          <p style={{ color: "var(--ink-muted)" }}>
            الفترة: {fmtDate(req.period_start)} → {req.period_end ? fmtDate(req.period_end) : "…"}
            {acct ? ` — العهدة: ${acct.holder_label}` : ""}
          </p>
        )}
      </header>

      <RequestLifecycle requestId={req.id} status={req.status} role={m.role} />

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
