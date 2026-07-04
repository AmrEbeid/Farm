import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { EXPENSE_KIND_AR, PAYMENT_STATUS_AR } from "@/lib/labels";
import type { ApprovalStep, PillStatus, TabItem } from "@amrebeid/ui";
import { Alert, ApprovalChain, Breadcrumbs, Card, EmptyState } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
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
import { accountOptionLabel, leafPostingAccounts } from "@/components/AccountPicker";

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

// EXPENSE_KIND_AR + PAYMENT_STATUS_AR now hoisted to lib/labels.ts (A5).

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
    .select(
      "id, request_no, status, period_start, period_end, custody_account_id, note, approved_post_paid_total, approved_custody_top_up, approved_net_request, created_at, prepared_by, submitted_at, approved_op_by, approved_op_at, approved_final_by, approved_final_at",
    )
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

  // Approval-trail actors — resolve the real prepared_by/approved_op_by/approved_final_by
  // user ids to people.name (org-scoped; people.tenant_all + the id/name/user_id column
  // grant already allow any org member to read a colleague's name, so no extra gate needed
  // beyond the finance.read this page already requires).
  const actorIds = Array.from(
    new Set(
      [req.prepared_by, req.approved_op_by, req.approved_final_by].filter(
        (id): id is string => id != null,
      ),
    ),
  );

  const ids = (linesRes.data ?? []).map((l) => l.expense_id);
  const [expensesRes, acctRes, availableExpensesRes, actorsRes, coaAccountsRes] = await Promise.all([
    ids.length
      ? sb.from("expenses").select("id, date, description, category, total, payment_status, kind, account_id").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; date: string | null; description: string | null; category: string | null; total: number | null; payment_status: string | null; kind: string | null; account_id: string | null }[], error: null }),
    req.custody_account_id
      ? sb.from("custody_accounts").select("holder_label").eq("id", req.custody_account_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    req.status === "draft"
      ? sb
          .from("expenses")
          .select("id, description, category, total, payment_status, kind, account_id")
          .in("payment_status", ["post_paid_unpaid", "paid_from_custody"])
          .order("date", { ascending: false })
          .limit(150)
      : Promise.resolve({ data: [] as { id: string; description: string | null; category: string | null; total: number | null; payment_status: string | null; kind: string | null; account_id: string | null }[], error: null }),
    actorIds.length
      ? sb.from("people").select("user_id, name").in("user_id", actorIds)
      : Promise.resolve({ data: [] as { user_id: string | null; name: string | null }[], error: null }),
    sb
      .from("accounts")
      .select("id, code, name_ar, account_type, kind, parent_id, active")
      .order("code", { ascending: true }),
  ]);
  if (expensesRes.error) throw expensesRes.error;
  if (acctRes.error) throw acctRes.error;
  if (availableExpensesRes.error) throw availableExpensesRes.error;
  if (actorsRes.error) throw actorsRes.error;
  if (coaAccountsRes.error) throw coaAccountsRes.error;

  const t: Totals = (totalsRes.data as Totals) ?? {};
  const requestLines = linesRes.data ?? [];
  const exp = expensesRes.data ?? [];
  const accounts = accountsRes.data ?? [];
  const accountOptions = accounts.map((a) => ({ id: a.id, holder_label: a.holder_label }));
  const accountLabelById = new Map(accounts.map((a) => [a.id, a.holder_label]));
  const postingAccounts = leafPostingAccounts(coaAccountsRes.data ?? []);
  const postingAccountLabelById = new Map(
    postingAccounts.map((account) => [account.id, accountOptionLabel(account)]),
  );
  const lineByExpenseId = new Map(requestLines.map((line) => [line.expense_id, line]));
  const linkedExpenseIds = new Set(ids);
  const availableExpenses = (availableExpensesRes.data ?? []).filter((e) => !linkedExpenseIds.has(e.id));
  const unclassifiedAvailableCount = availableExpenses.filter((e) => e.account_id == null).length;
  const availableExpenseOptions = availableExpenses
    .filter((e) => e.account_id != null)
    .map((e) => ({
      id: e.id,
      label: `${e.description ?? e.category ?? "مصروف"} — ${postingAccountLabelById.get(e.account_id ?? "") ?? "حساب غير معروف"} — ${EXPENSE_KIND_AR[e.kind ?? "operating"] ?? "غير مصنف"} — ${PAYMENT_STATUS_AR[e.payment_status ?? ""] ?? "غير محدد"} — ${egp(Number(e.total ?? 0))}`,
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
    { id: "account", header: "الحساب" },
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
    account: e.account_id ? postingAccountLabelById.get(e.account_id) ?? "—" : "بدون حساب",
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
      label: `${e.description ?? e.category ?? "مصروف"} — ${postingAccountLabelById.get(e.account_id ?? "") ?? "حساب غير معروف"} — ${EXPENSE_KIND_AR[e.kind ?? "operating"] ?? "غير مصنف"} — ${egp(Number(e.total ?? 0))}`,
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

  // R-2 (SPEC-0025): the request's story in ONE sentence + who acts NEXT — the rail's head.
  // Every wait-state names its actor; the cycle is never a maze again.
  const unclassifiedCount = exp.filter(
    (e) => e.payment_status === "post_paid_unpaid" && !e.account_id && !lineByExpenseId.get(e.id)?.paid_at,
  ).length;
  const gross = Number(t.gross_request ?? 0);
  const railLead =
    req.status === "draft"
      ? `مسودة بها ${num(lineRows.length)} مصروفًا${gross > 0 ? ` بإجمالي ${egp(gross)}` : ""} — التالي: المحاسب يكمل البنود ويرسل للاعتماد.`
      : req.status === "submitted"
        ? `أُرسل الطلب (${egp(gross)}) — التالي: الاعتماد التشغيلي (مدير المزرعة).`
        : req.status === "approved_operational"
          ? `اعتمده المدير — التالي: اعتماد المالك (${egp(gross)}).`
          : req.status === "approved_final"
            ? `اعتمده المالك — التالي: تسجيل التمويل (المتبقي ${egp(remainingToFund)}).`
            : req.status === "paid" && pendingLineCount > 0
              ? `التمويل مكتمل — التالي: تأكيد سداد ${num(pendingLineCount)} بند من العهدة.`
              : req.status === "paid"
                ? "اكتملت الدورة ✓ — كل البنود مموّلة ومسدَّدة ومقيَّدة."
                : `الحالة: ${REQ_STATUS_AR[req.status ?? ""] ?? req.status ?? "غير معروفة"}.`;
  const railNotes: string[] = [];
  if (unclassifiedCount > 0)
    railNotes.push(`⚠ ${num(unclassifiedCount)} مصروف آجل بلا حساب محاسبي — لن يُقبل في الطلب حتى يُصنَّف (من صفحة المصروفات أو معالج «سجّل»).`);


  // Approval trail: each stage renders ONLY when its actor+timestamp columns are actually
  // populated (real data or absent — never fabricated). Stages not yet reached show as
  // "requested" (not started); the paper إذن صرف carries three signatures — محاسب
  // (prepare/submit), مدير المزرعة (operational), المالك (final) — mirrored here 1:1.
  const actorNames = new Map(
    (actorsRes.data ?? [])
      .filter((p): p is { user_id: string; name: string | null } => p.user_id != null)
      .map((p) => [p.user_id, p.name ?? "—"]),
  );
  const preparedByName = req.prepared_by ? (actorNames.get(req.prepared_by) ?? "—") : null;
  const approvedOpByName = req.approved_op_by ? (actorNames.get(req.approved_op_by) ?? "—") : null;
  const approvedFinalByName = req.approved_final_by
    ? (actorNames.get(req.approved_final_by) ?? "—")
    : null;

  const approvalSteps: ApprovalStep[] = [
    {
      id: "prepared",
      state: "approved",
      actor: `إنشاء المسودة — ${preparedByName ?? "—"}`,
      note: fmtDate(req.created_at),
    },
    {
      id: "submitted",
      state: req.submitted_at ? "approved" : "pending",
      actor: req.submitted_at ? "إرسال للاعتماد" : "بانتظار الإرسال للاعتماد",
      note: req.submitted_at ? fmtDate(req.submitted_at) : undefined,
    },
    {
      id: "approved_op",
      state: req.approved_op_at ? "approved" : req.submitted_at ? "pending" : "requested",
      actor: req.approved_op_at
        ? `اعتماد تشغيلي (مدير المزرعة) — ${approvedOpByName ?? "—"}`
        : "اعتماد تشغيلي (مدير المزرعة)",
      note: req.approved_op_at ? fmtDate(req.approved_op_at) : undefined,
    },
    {
      id: "approved_final",
      state: req.approved_final_at ? "approved" : req.approved_op_at ? "pending" : "requested",
      actor: req.approved_final_at
        ? `اعتماد نهائي (المالك) — ${approvedFinalByName ?? "—"}`
        : "اعتماد نهائي (المالك)",
      note: req.approved_final_at ? fmtDate(req.approved_final_at) : undefined,
    },
  ];

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "expenses", label: `المصروفات (${num(lineRows.length)})` },
    { id: "settlement", label: "التمويل والسداد" },
    { id: "add", label: "إضافة" },
  ];

  return (
    <div className="flex flex-col gap-5 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        className="no-print"
        items={[
          { id: "custody", label: "العهدة وطلبات الصرف", href: "/custody" },
          { id: "request", label: `إذن صرف رقم ${num(req.request_no)}` },
        ]}
      />
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

      <StoryLine lead={railLead} notes={railNotes} />

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

          <Card title="مسار الاعتماد">
            <ApprovalChain steps={approvalSteps} ariaLabel="مسار اعتماد طلب الصرف" />
          </Card>

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
        <div
          role="tabpanel"
          id={tabPanelId("add")}
          aria-labelledby={tabId("add")}
          tabIndex={0}
          className="flex flex-col gap-4"
        >
          {req.status === "draft" && unclassifiedAvailableCount > 0 && (
            <Alert
              tone="warning"
              title={`${num(unclassifiedAvailableCount)} مصروف مؤجل أو مدفوع من العهدة بدون حساب محاسبي`}
              description="لن يظهر المصروف هنا قبل اختيار حسابه من شاشة المصروفات، حتى لا يدخل إذن الصرف بدون تصنيف محاسبي."
            />
          )}
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
