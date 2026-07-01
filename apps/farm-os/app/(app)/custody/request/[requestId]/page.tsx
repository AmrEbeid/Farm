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
import {
  AddExpenseToPaymentRequest,
  RecordRequestFunding,
  ConfirmRequestExpensePayment,
  ClosePaymentRequestButton,
} from "@/components/CustodyForms";
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
  operating_unpaid?: number;
  capex_unpaid?: number;
  drawing_unpaid?: number;
  post_paid_unpaid?: number;
  target_float?: number;
  current_custody?: number;
  custody_top_up?: number;
  gross_request?: number;
  approved_post_paid_total?: number;
  approved_custody_top_up?: number;
  approved_net_request?: number;
  owner_funding_received?: number;
  request_cash_out?: number;
  remaining_to_fund?: number;
  net_request?: number;
};

const EXPENSE_KIND_AR: Record<string, string> = {
  operating: "تشغيلي",
  capex: "رأسمالي",
  drawing: "مسحوبات مالك",
};

const PAYMENT_STATUS_AR: Record<string, string> = {
  post_paid_unpaid: "آجل غير مدفوع",
  paid_from_custody: "مدفوع من العهدة",
  paid_by_owner: "مدفوع من المالك",
  cancelled: "ملغي",
};

const TAB_IDS = ["overview", "expenses", "settlement", "add"] as const;
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
    .select("id, request_no, status, period_start, period_end, custody_account_id, note, approved_post_paid_total, approved_custody_top_up, approved_net_request")
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

  const [linesRes, totalsRes, orgRes, accountsRes, fundingsRes] = await Promise.all([
    sb
      .from("payment_request_lines")
      .select("id, expense_id, paid_at, paid_by, paid_from_custody_account_id, custody_movement_id, journal_entry_id")
      .eq("payment_request_id", requestId),
    sb.rpc("fn_payment_request_totals", { p_request: requestId }),
    sb.from("organization").select("name").eq("id", m.orgId).maybeSingle(),
    sb.from("custody_accounts").select("id, holder_label, active").eq("active", true).order("holder_label"),
    sb
      .from("payment_request_fundings")
      .select("id, occurred_at, amount, custody_account_id, note")
      .eq("payment_request_id", requestId)
      .order("occurred_at", { ascending: false }),
  ]);
  if (linesRes.error) throw linesRes.error;
  if (totalsRes.error) throw totalsRes.error;
  if (orgRes.error) throw orgRes.error;
  if (accountsRes.error) throw accountsRes.error;
  if (fundingsRes.error) throw fundingsRes.error;

  const ids = (linesRes.data ?? []).map((l) => l.expense_id);
  const [expensesRes, acctRes, availableExpensesRes] = await Promise.all([
    ids.length
      ? sb.from("expenses").select("id, date, description, category, total, payment_status, kind").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; date: string | null; description: string | null; category: string | null; total: number | null; payment_status: string | null; kind: string | null }[], error: null }),
    req.custody_account_id
      ? sb.from("custody_accounts").select("holder_label").eq("id", req.custody_account_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    req.status === "draft"
      ? sb
          .from("expenses")
          .select("id, description, category, total, payment_status, kind")
          .in("payment_status", ["post_paid_unpaid", "paid_from_custody"])
          .order("date", { ascending: false })
          .limit(150)
      : Promise.resolve({ data: [] as { id: string; description: string | null; category: string | null; total: number | null; payment_status: string | null; kind: string | null }[], error: null }),
  ]);
  if (expensesRes.error) throw expensesRes.error;
  if (acctRes.error) throw acctRes.error;
  if (availableExpensesRes.error) throw availableExpensesRes.error;

  const t: Totals = (totalsRes.data as Totals) ?? {};
  const requestLines = linesRes.data ?? [];
  const exp = expensesRes.data ?? [];
  const accounts = accountsRes.data ?? [];
  const accountOptions = accounts.map((a) => ({ id: a.id, holder_label: a.holder_label }));
  const accountLabelById = new Map(accounts.map((a) => [a.id, a.holder_label]));
  const lineByExpenseId = new Map(requestLines.map((line) => [line.expense_id, line]));
  const linkedExpenseIds = new Set(ids);
  const availableExpenseOptions = (availableExpensesRes.data ?? [])
    .filter((e) => !linkedExpenseIds.has(e.id))
    .map((e) => ({
      id: e.id,
      label: `${e.description ?? e.category ?? "مصروف"} — ${EXPENSE_KIND_AR[e.kind ?? "operating"] ?? "غير مصنف"} — ${PAYMENT_STATUS_AR[e.payment_status ?? ""] ?? "غير محدد"} — ${egp(Number(e.total ?? 0))}`,
    }));

  const cats = new Map<string, { operating: number; capex: number; drawing: number; paid: number }>();
  for (const e of exp) {
    const k = e.category ?? "أخرى";
    const row = cats.get(k) ?? { operating: 0, capex: 0, drawing: 0, paid: 0 };
    const line = lineByExpenseId.get(e.id);
    const total = Number(e.total ?? 0);
    if (line?.paid_at || e.payment_status === "paid_from_custody") {
      row.paid += total;
    } else if (e.payment_status === "post_paid_unpaid" && e.kind === "capex") {
      row.capex += total;
    } else if (e.payment_status === "post_paid_unpaid" && e.kind === "drawing") {
      row.drawing += total;
    } else if (e.payment_status === "post_paid_unpaid") {
      row.operating += total;
    }
    cats.set(k, row);
  }
  const catCols: SimpleColumn[] = [
    { id: "cat", header: "الفئة" },
    { id: "operating", header: "تشغيلي آجل", numeric: true },
    { id: "capex", header: "رأسمالي آجل", numeric: true },
    { id: "drawing", header: "مسحوبات آجل", numeric: true },
    { id: "paid", header: "مدفوع من العهدة", numeric: true },
  ];
  const catRows = [...cats.entries()].map(([cat, v], i) => ({
    id: String(i),
    cat,
    operating: egp(v.operating),
    capex: egp(v.capex),
    drawing: egp(v.drawing),
    paid: egp(v.paid),
  }));

  const lineCols: SimpleColumn[] = [
    { id: "desc", header: "البيان" },
    { id: "kind", header: "النوع" },
    { id: "cat", header: "الفئة" },
    { id: "status", header: "حالة السداد" },
    { id: "paid_from", header: "مصدر العهدة" },
    { id: "paid_at", header: "تاريخ السداد" },
    { id: "total", header: "الإجمالي", numeric: true },
  ];
  const lineRows = exp.map((e) => ({
    id: e.id,
    desc: e.description ?? "—",
    kind: EXPENSE_KIND_AR[e.kind ?? "operating"] ?? "غير مصنف",
    cat: e.category ?? "—",
    status: lineByExpenseId.get(e.id)?.paid_at
      ? "تم السداد من العهدة"
      : PAYMENT_STATUS_AR[e.payment_status ?? ""] ?? "غير محدد",
    paid_from: accountLabelById.get(lineByExpenseId.get(e.id)?.paid_from_custody_account_id ?? "") ?? "—",
    paid_at: lineByExpenseId.get(e.id)?.paid_at ? fmtDate(lineByExpenseId.get(e.id)?.paid_at ?? "") : "—",
    total: egp(Number(e.total ?? 0)),
  }));

  const payableExpenseOptions = exp
    .filter((e) => e.payment_status === "post_paid_unpaid" && !lineByExpenseId.get(e.id)?.paid_at)
    .map((e) => ({
      id: e.id,
      label: `${e.description ?? e.category ?? "مصروف"} — ${EXPENSE_KIND_AR[e.kind ?? "operating"] ?? "غير مصنف"} — ${egp(Number(e.total ?? 0))}`,
    }));

  const fundingCols: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "account", header: "دخلت في عهدة" },
    { id: "amount", header: "المبلغ", numeric: true },
    { id: "note", header: "ملاحظات" },
  ];
  const fundingRows = (fundingsRes.data ?? []).map((funding) => ({
    id: funding.id,
    date: fmtDate(funding.occurred_at),
    account: accountLabelById.get(funding.custody_account_id) ?? "—",
    amount: egp(Number(funding.amount ?? 0)),
    note: funding.note ?? "—",
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
  const remainingToFund = Number(t.remaining_to_fund ?? t.net_request ?? 0);
  const pendingLineCount = payableExpenseOptions.length;

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "expenses", label: `المصروفات (${num(lineRows.length)})` },
    { id: "settlement", label: "التمويل والسداد" },
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

      {remainingToFund > 0 && (
        <Alert
          tone="warning"
          title="تمويل مطلوب من المالك"
          description={`المتبقي تسجيله كعهدة من تمويل المالك: ${egp(remainingToFund)}.`}
        />
      )}
      {req.status === "paid" && pendingLineCount > 0 && (
        <Alert
          tone="warning"
          title="السداد يحتاج تأكيد"
          description={`تم تسجيل تمويل المالك، ويتبقى تأكيد سداد ${num(pendingLineCount)} بند من العهدة.`}
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
            <Card title="تشغيلي آجل"><p className="text-xl font-bold">{egp(t.operating_unpaid ?? 0)}</p></Card>
            <Card title="رأسمالي آجل"><p className="text-xl font-bold">{egp(t.capex_unpaid ?? 0)}</p></Card>
            <Card title="مسحوبات آجل"><p className="text-xl font-bold">{egp(t.drawing_unpaid ?? 0)}</p></Card>
            <Card title="تغذية عهدة مطلوبة"><p className="text-xl font-bold">{egp(t.custody_top_up ?? 0)}</p></Card>
            <Card title="المعتمد من المالك"><p className="text-xl font-bold">{egp(t.approved_net_request ?? t.gross_request ?? 0)}</p></Card>
            <Card title="تمويل مستلم كعهدة"><p className="text-xl font-bold">{egp(t.owner_funding_received ?? 0)}</p></Card>
            <Card title="مدفوع من الطلب"><p className="text-xl font-bold">{egp(t.request_cash_out ?? 0)}</p></Card>
            <Card title="المتبقي تمويله"><p className="text-xl font-bold" style={{ color: "var(--brand)" }}>{egp(remainingToFund)}</p></Card>
          </div>

          <Card title="الملخص حسب الفئة">
            <SimpleTable columns={catCols} rows={catRows} ariaLabel="الملخص حسب الفئة" empty="لا توجد بنود بعد" />
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
            <SimpleTable columns={lineCols} rows={lineRows} ariaLabel="البنود التفصيلية" empty="لم تُضف بنود لهذا الطلب بعد" />
          </Card>
        </div>
      )}

      {tab === "settlement" && (
        <div
          role="tabpanel"
          id={tabPanelId("settlement")}
          aria-labelledby={tabId("settlement")}
          tabIndex={0}
          className="grid gap-5 lg:grid-cols-2"
        >
          <Card title="تمويل المالك">
            {req.status === "approved_final" || (req.status === "paid" && remainingToFund > 0) ? (
              <RecordRequestFunding requestId={req.id} accounts={accountOptions} remainingToFund={remainingToFund} />
            ) : (
              <p style={{ color: "var(--ink-muted)" }}>
                يظهر تسجيل التمويل بعد الاعتماد النهائي، ويُسجل كعهدة أولًا قبل السداد.
              </p>
            )}
          </Card>

          <Card title="تأكيد السداد من العهدة">
            {req.status === "paid" ? (
              <ConfirmRequestExpensePayment requestId={req.id} expenses={payableExpenseOptions} accounts={accountOptions} />
            ) : (
              <p style={{ color: "var(--ink-muted)" }}>
                يظهر تأكيد السداد بعد استلام تمويل المالك بالكامل وتسجيله على العهدة.
              </p>
            )}
          </Card>

          <Card title="التمويلات المسجلة">
            <SimpleTable columns={fundingCols} rows={fundingRows} ariaLabel="التمويلات المسجلة" empty="لا توجد تمويلات مسجلة بعد" />
          </Card>

          <Card title="إقفال الطلب">
            {req.status === "paid" && pendingLineCount === 0 ? (
              <ClosePaymentRequestButton requestId={req.id} />
            ) : req.status === "closed" ? (
              <p style={{ color: "var(--ink-muted)" }}>الطلب مقفل.</p>
            ) : (
              <p style={{ color: "var(--ink-muted)" }}>يمكن الإقفال بعد تمويل الطلب وتأكيد سداد كل البنود.</p>
            )}
          </Card>
        </div>
      )}

      {tab === "add" && (
        <div role="tabpanel" id={tabPanelId("add")} aria-labelledby={tabId("add")} tabIndex={0}>
          {req.status === "draft" ? (
            <Card title="إضافة مصروف للطلب">
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
