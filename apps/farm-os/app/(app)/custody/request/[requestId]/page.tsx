import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { PillStatus, TabItem } from "@amrebeid/ui";
import { Alert, Card, EmptyState } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { RequestLifecycle } from "@/components/RequestLifecycle";
import { AddExpenseToPaymentRequest } from "@/components/CustodyForms";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";

// SPEC-0018 slice 5 — the printable monthly «إذن صرف» + lifecycle, rebuilt as an Entity-360 page.
// Renders live from the RLS-scoped request/lines/expenses + fn_payment_request_totals.
// Finance-gated; print via the toolbar button.
const REQ_STATUS_AR: Record<string, string> = {
  draft: "مسودة", submitted: "مُرسل", approved_operational: "اعتماد تشغيلي",
  approved_final: "اعتماد نهائي", paid: "مدفوع", closed: "مُقفل",
};

// Maps the request lifecycle onto the shared 360 pill vocabulary: draft → draft,
// submitted → scheduled (awaiting action), the two approvals → active (in flight),
// paid/closed → done, anything rejected/cancelled → blocked.
function pillStatus(s: string): PillStatus {
  if (s === "draft") return "draft";
  if (s === "submitted") return "scheduled";
  if (s === "approved_operational" || s === "approved_final") return "active";
  if (s === "paid" || s === "closed") return "done";
  if (s === "rejected" || s === "cancelled") return "blocked";
  return "draft";
}

type Totals = {
  post_paid_unpaid?: number; target_float?: number; current_custody?: number;
  custody_top_up?: number; net_request?: number;
};

const TAB_IDS = ["overview", "expenses", "add"] as const;
type RequestTab = (typeof TAB_IDS)[number];

export default async function PaymentRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { requestId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: RequestTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as RequestTab)
    : "overview";
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

  const orgName = orgRes.data?.name ?? "مزارع عبيد";
  const holderLabel = acctRes.data?.holder_label ?? null;
  const periodLabel = req.period_start
    ? `${fmtDate(req.period_start)} → ${req.period_end ? fmtDate(req.period_end) : "…"}`
    : null;
  const subtitleParts = [
    orgName,
    holderLabel ? `العهدة: ${holderLabel}` : null,
    periodLabel ? `الفترة: ${periodLabel}` : null,
  ].filter(Boolean) as string[];

  // Attention surfacing from the live totals: there is post-paid unpaid liability
  // still on the books, or a net amount the owner is asked to fund.
  const postPaidUnpaid = Number(t.post_paid_unpaid ?? 0);
  const netRequest = Number(t.net_request ?? 0);

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "expenses", label: `المصروفات (${num(lineRows.length)})` },
    { id: "add", label: "إضافة" },
  ];

  return (
    <div className="flex flex-col gap-5 p-6">
      <Link href="/custody" className="text-sm no-print" style={{ color: "var(--ink-muted)" }}>→ العودة للعهدة</Link>

      <Entity360Header
        title={`إذن صرف رقم ${num(req.request_no)}`}
        subtitle={subtitleParts.join(" · ")}
        pills={[{ status: pillStatus(req.status), label: REQ_STATUS_AR[req.status] ?? req.status }]}
        actions={<HeaderLink href="/custody">سجل العهدة</HeaderLink>}
      />

      {netRequest > 0 && (
        <Alert
          tone="warning"
          title="صافي مطلوب من المالك"
          description={`المطلوب تمويله من المالك: ${egp(netRequest)}.`}
        />
      )}
      {postPaidUnpaid > 0 && (
        <Alert
          tone="warning"
          title="آجل غير مدفوع"
          description={`هناك مصروفات آجلة غير مدفوعة بقيمة ${egp(postPaidUnpaid)}.`}
        />
      )}

      <EntityTabs items={tabItems} value={tab} ariaLabel="أقسام طلب الصرف" />

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-5"
        >
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

          <div className="grid grid-cols-3 gap-6 pt-8 text-center text-sm">
            <div>المحاسب<br /><br />التوقيع: ...........</div>
            <div>مدير المزرعة<br /><br />التوقيع: ...........</div>
            <div>المالك<br /><br />التوقيع: ...........</div>
          </div>
        </div>
      )}

      {tab === "expenses" && (
        <div role="tabpanel" id={tabPanelId("expenses")} aria-labelledby={tabId("expenses")} tabIndex={0}>
          <Card title="البنود التفصيلية">
            <SimpleTable columns={lineCols} rows={lineRows} empty="لم تُضف بنود لهذا الطلب بعد" />
          </Card>
        </div>
      )}

      {tab === "add" && (
        <div role="tabpanel" id={tabPanelId("add")} aria-labelledby={tabId("add")} tabIndex={0}>
          {req.status === "draft" ? (
            <Card title="إضافة مصروف آجل للطلب">
              <AddExpenseToPaymentRequest requestId={req.id} expenses={availableExpenseOptions} />
            </Card>
          ) : (
            <EmptyState title="لا يمكن إضافة بنود" description="يمكن إضافة المصروفات إلى الطلب وهو في حالة المسودة فقط." />
          )}
        </div>
      )}
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold no-print"
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
