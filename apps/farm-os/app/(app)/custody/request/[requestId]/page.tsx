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
import { num } from "@/lib/money";
import { accountOptionLabel, leafPostingAccounts } from "@/components/AccountPicker";
import type { DecimalString } from "@/lib/decimal";
import {
  addPaymentRequestAmounts,
  isPositivePaymentRequestAmount,
  paymentRequestAmount,
  paymentRequestAmountEgp,
  parsePaymentRequestDetailSnapshot,
} from "@/lib/payment request detail";

// SPEC-0018 slice 5 — the printable monthly «إذن صرف» + lifecycle, rebuilt as an Entity-360 page.
// Renders from one finance-gated, organization-scoped atomic detail snapshot.
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

  const snapshotRes = await sb.rpc("fn_payment_request_detail_snapshot", {
    p_org: m.orgId,
    p_request: requestId,
    p_available_limit: 150,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const detail = parsePaymentRequestDetailSnapshot(snapshotRes.data, m.orgId, requestId);
  const req = detail.request;

  if (!req) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Link href="/custody" className="text-sm" style={{ color: "var(--ink-muted)" }}>→ العودة للعهدة</Link>
        <EmptyState title="طلب الصرف غير موجود" />
      </div>
    );
  }
  if (!detail.totals || !detail.organizationName) {
    throw new Error("payment request detail snapshot: present request is incomplete");
  }

  const t = detail.totals;
  const requestLines = detail.lines;
  const exp = requestLines.map((line) => line.expense);
  const accountOptions = detail.custodyAccounts
    .filter((account) => account.active)
    .map((account) => ({ id: account.id, holder_label: account.holder_label }));
  const accountLabelById = new Map(
    detail.custodyAccounts.map((account) => [account.id, account.holder_label]),
  );
  const postingAccounts = leafPostingAccounts(detail.accounts);
  const postingAccountLabelById = new Map(
    postingAccounts.map((account) => [account.id, accountOptionLabel(account)]),
  );
  const lineByExpenseId = new Map(requestLines.map((line) => [line.expense_id, line]));
  const availableExpenseOptions = detail.availableExpenses
    .map((e) => ({
      id: e.id,
      label: `${e.description ?? e.category ?? "مصروف"} — ${postingAccountLabelById.get(e.account_id ?? "") ?? "حساب غير معروف"} — ${EXPENSE_KIND_AR[e.kind ?? "operating"] ?? "غير مصنف"} — ${PAYMENT_STATUS_AR[e.payment_status ?? ""] ?? "غير محدد"} — ${paymentRequestAmountEgp(paymentRequestAmount(e.total, `expense ${e.id} total`))}`,
    }));
  const unclassifiedAvailableCount = detail.unclassifiedAvailableCount;
  const hiddenAvailableExpenseCount = detail.availableExpenseCount - detail.availableExpenses.length;

  const cats = new Map<string, { operating: DecimalString; capex: DecimalString; drawing: DecimalString; paid: DecimalString }>();
  for (const e of exp) {
    const k = e.category ?? "أخرى";
    const row = cats.get(k) ?? { operating: "0", capex: "0", drawing: "0", paid: "0" };
    const line = lineByExpenseId.get(e.id);
    const total = paymentRequestAmount(e.total, `expense ${e.id} total`);
    if (line?.paid_at || e.payment_status === "paid_from_custody") {
      row.paid = addPaymentRequestAmounts(row.paid, total);
    } else if (e.payment_status === "post_paid_unpaid" && e.kind === "capex") {
      row.capex = addPaymentRequestAmounts(row.capex, total);
    } else if (e.payment_status === "post_paid_unpaid" && e.kind === "drawing") {
      row.drawing = addPaymentRequestAmounts(row.drawing, total);
    } else if (e.payment_status === "post_paid_unpaid") {
      row.operating = addPaymentRequestAmounts(row.operating, total);
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
    operating: paymentRequestAmountEgp(v.operating),
    capex: paymentRequestAmountEgp(v.capex),
    drawing: paymentRequestAmountEgp(v.drawing),
    paid: paymentRequestAmountEgp(v.paid),
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
    total: paymentRequestAmountEgp(paymentRequestAmount(e.total, `expense ${e.id} total`)),
  }));

  const payableExpenseOptions = exp
    .filter((e) => e.payment_status === "post_paid_unpaid" && !lineByExpenseId.get(e.id)?.paid_at)
    .map((e) => ({
      id: e.id,
      label: `${e.description ?? e.category ?? "مصروف"} — ${postingAccountLabelById.get(e.account_id ?? "") ?? "حساب غير معروف"} — ${EXPENSE_KIND_AR[e.kind ?? "operating"] ?? "غير مصنف"} — ${paymentRequestAmountEgp(paymentRequestAmount(e.total, `expense ${e.id} total`))}`,
    }));

  const fundingCols: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "account", header: "دخلت في عهدة" },
    { id: "amount", header: "المبلغ", numeric: true },
    { id: "note", header: "ملاحظات" },
  ];
  const fundingRows = detail.fundings.map((funding) => ({
    id: funding.id,
    date: fmtDate(funding.occurred_at),
    account: accountLabelById.get(funding.custody_account_id) ?? "—",
    amount: paymentRequestAmountEgp(paymentRequestAmount(funding.amount, `funding ${funding.id} amount`)),
    note: funding.note ?? "—",
  }));

  const orgName = detail.organizationName;
  const holderLabel = req.custody_account_label;
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
  const remainingToFund = t.remaining_to_fund;
  const remainingToFundPositive = isPositivePaymentRequestAmount(remainingToFund);
  const pendingLineCount = detail.lines.filter((line) => line.paid_at == null).length;

  // R-2 (SPEC-0025): the request's story in ONE sentence + who acts NEXT — the rail's head.
  // Every wait-state names its actor; the cycle is never a maze again.
  const unclassifiedCount = exp.filter(
    (e) => e.payment_status === "post_paid_unpaid" && !e.account_id && !lineByExpenseId.get(e.id)?.paid_at,
  ).length;
  const gross = t.gross_request;
  const grossPositive = isPositivePaymentRequestAmount(gross);
  const railLead =
    req.status === "draft"
      ? `مسودة بها ${num(lineRows.length)} مصروفًا${grossPositive ? ` بإجمالي ${paymentRequestAmountEgp(gross)}` : ""} — التالي: المحاسب يكمل البنود ويرسل للاعتماد.`
      : req.status === "submitted"
        ? `أُرسل الطلب (${paymentRequestAmountEgp(gross)}) — التالي: الاعتماد التشغيلي (مدير المزرعة).`
        : req.status === "approved_operational"
          ? `اعتمده المدير — التالي: اعتماد المالك (${paymentRequestAmountEgp(gross)}).`
          : req.status === "approved_final"
            ? `اعتمده المالك — التالي: تسجيل التمويل (المتبقي ${paymentRequestAmountEgp(remainingToFund)}).`
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
    detail.actors.map((person) => [person.user_id, person.name]),
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

  const proofSummary = [
    { id: "request_no", label: "رقم الإذن", value: num(req.request_no) },
    { id: "org", label: "المزرعة", value: orgName },
    { id: "holder", label: "العهدة", value: holderLabel ?? "—" },
    { id: "period", label: "الفترة", value: periodLabel ?? "—" },
    { id: "status", label: "الحالة", value: REQ_STATUS_AR[req.status] ?? req.status },
    { id: "gross", label: "إجمالي الطلب", value: paymentRequestAmountEgp(t.gross_request) },
    { id: "approved", label: "المعتمد من المالك", value: paymentRequestAmountEgp(t.approved_net_request) },
    { id: "funded", label: "تمويل مستلم كعهدة", value: paymentRequestAmountEgp(t.owner_funding_received) },
    { id: "paid", label: "مدفوع من الطلب", value: paymentRequestAmountEgp(t.request_cash_out) },
    { id: "remaining", label: "المتبقي تمويله", value: paymentRequestAmountEgp(remainingToFund) },
  ];
  const proofCols: SimpleColumn[] = [
    { id: "stage", header: "المرحلة" },
    { id: "actor", header: "المسؤول" },
    { id: "date", header: "التاريخ" },
    { id: "state", header: "الحالة" },
    { id: "signature", header: "التوقيع" },
  ];
  const proofRows = [
    {
      id: "prepared",
      stage: "إعداد الإذن",
      actor: preparedByName ?? "—",
      date: fmtDate(req.created_at),
      state: "مثبت",
      signature: "....................",
    },
    {
      id: "submitted",
      stage: "إرسال للاعتماد",
      actor: preparedByName ?? "—",
      date: req.submitted_at ? fmtDate(req.submitted_at) : "—",
      state: req.submitted_at ? "تم" : "بانتظار الإرسال",
      signature: "....................",
    },
    {
      id: "approved_op",
      stage: "اعتماد تشغيلي",
      actor: approvedOpByName ?? "—",
      date: req.approved_op_at ? fmtDate(req.approved_op_at) : "—",
      state: req.approved_op_at ? "تم" : req.submitted_at ? "بانتظار الاعتماد" : "لم يبدأ",
      signature: "....................",
    },
    {
      id: "approved_final",
      stage: "اعتماد نهائي",
      actor: approvedFinalByName ?? "—",
      date: req.approved_final_at ? fmtDate(req.approved_final_at) : "—",
      state: req.approved_final_at ? "تم" : req.approved_op_at ? "بانتظار المالك" : "لم يبدأ",
      signature: "....................",
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

      {remainingToFundPositive && (
        <Alert
          tone="warning"
          title="تمويل مطلوب من المالك"
          description={`المتبقي تسجيله كعهدة من تمويل المالك: ${paymentRequestAmountEgp(remainingToFund)}.`}
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

      <div className="no-print">
        <EntityTabs items={tabItems} value={tab} ariaLabel="أقسام طلب الصرف" />
      </div>

      <section className="print-only">
        <div className="flex flex-col gap-5">
          <Card title="حزمة إذن الصرف للطباعة">
            <div className="grid gap-3 md:grid-cols-5">
              {proofSummary.map((item) => (
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

          <Card title="مسار الاعتماد والتوقيع">
            <SimpleTable
              columns={proofCols}
              rows={proofRows}
              ariaLabel="مسار الاعتماد والتوقيع"
              empty="لا توجد مراحل اعتماد"
            />
          </Card>

          <Card title="الملخص حسب الفئة">
            <SimpleTable columns={catCols} rows={catRows} ariaLabel="الملخص حسب الفئة" empty="لا توجد بنود بعد" />
          </Card>

          <Card title="البنود التفصيلية">
            <SimpleTable columns={lineCols} rows={lineRows} ariaLabel="البنود التفصيلية للطباعة" empty="لم تُضف بنود لهذا الطلب بعد" />
          </Card>

          <Card title="التمويلات المسجلة">
            <SimpleTable columns={fundingCols} rows={fundingRows} ariaLabel="التمويلات المسجلة للطباعة" empty="لا توجد تمويلات مسجلة بعد" />
          </Card>
        </div>
      </section>

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-5 no-print"
        >
          <RequestLifecycle requestId={req.id} status={req.status} role={m.role} />

          <Card title="مسار الاعتماد">
            <ApprovalChain steps={approvalSteps} ariaLabel="مسار اعتماد طلب الصرف" />
          </Card>

          <Card title="حزمة الطباعة والتوقيع">
            <div className="grid gap-3 md:grid-cols-5">
              {proofSummary.map((item) => (
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
            <div className="mt-4">
              <SimpleTable
                columns={proofCols}
                rows={proofRows}
                ariaLabel="حزمة الطباعة والتوقيع"
                empty="لا توجد مراحل اعتماد"
              />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card title="تشغيلي آجل"><p className="text-xl font-bold">{paymentRequestAmountEgp(t.operating_unpaid)}</p></Card>
            <Card title="رأسمالي آجل"><p className="text-xl font-bold">{paymentRequestAmountEgp(t.capex_unpaid)}</p></Card>
            <Card title="مسحوبات آجل"><p className="text-xl font-bold">{paymentRequestAmountEgp(t.drawing_unpaid)}</p></Card>
            <Card title="تغذية عهدة مطلوبة"><p className="text-xl font-bold">{paymentRequestAmountEgp(t.custody_top_up)}</p></Card>
            <Card title="المعتمد من المالك"><p className="text-xl font-bold">{paymentRequestAmountEgp(t.approved_net_request)}</p></Card>
            <Card title="تمويل مستلم كعهدة"><p className="text-xl font-bold">{paymentRequestAmountEgp(t.owner_funding_received)}</p></Card>
            <Card title="مدفوع من الطلب"><p className="text-xl font-bold">{paymentRequestAmountEgp(t.request_cash_out)}</p></Card>
            <Card title="المتبقي تمويله"><p className="text-xl font-bold" style={{ color: "var(--brand)" }}>{paymentRequestAmountEgp(remainingToFund)}</p></Card>
          </div>

          <Card title="الملخص حسب الفئة">
            <SimpleTable columns={catCols} rows={catRows} ariaLabel="الملخص حسب الفئة" empty="لا توجد بنود بعد" />
          </Card>
        </div>
      )}

      {tab === "expenses" && (
        <div role="tabpanel" id={tabPanelId("expenses")} aria-labelledby={tabId("expenses")} tabIndex={0} className="no-print">
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
          className="grid gap-5 lg:grid-cols-2 no-print"
        >
          <Card title="تمويل المالك">
            {req.status === "approved_final" || (req.status === "paid" && remainingToFundPositive) ? (
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
          className="flex flex-col gap-4 no-print"
        >
          {req.status === "draft" && unclassifiedAvailableCount > 0 && (
            <Alert
              tone="warning"
              title={`${num(unclassifiedAvailableCount)} مصروف مؤجل أو مدفوع من العهدة بدون حساب محاسبي`}
              description="لن يظهر المصروف هنا قبل اختيار حسابه من شاشة المصروفات، حتى لا يدخل إذن الصرف بدون تصنيف محاسبي."
            />
          )}
          {req.status === "draft" && detail.availableExpensesTruncated && (
            <Alert
              tone="warning"
              title={`${num(hiddenAvailableExpenseCount)} مصروف إضافي جاهز خارج أحدث 150 مصروفًا`}
              description="راجع شاشة المصروفات لإضافة الأقدم؛ القائمة هنا لا تدّعي أنها كاملة."
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
