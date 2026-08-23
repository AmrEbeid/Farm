import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, FileText, Landmark, ReceiptText, WalletCards } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { EXPENSE_KIND_AR, PAYMENT_STATUS_AR } from "@/lib/labels";
import type { ApprovalStep, PillStatus, TabItem } from "@amrebeid/ui";
import { Alert, ApprovalChain, Breadcrumbs, Card, EmptyState, StatusPill } from "@/components/ui";
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
  paymentRequestSettlementState,
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
// submitted → scheduled (awaiting action), approvals/paid → active (in flight),
// closed → done, anything rejected/cancelled → blocked.
function pillStatus(s: string): PillStatus {
  if (s === "draft") return "draft";
  if (s === "submitted") return "scheduled";
  if (s === "approved_operational" || s === "approved_final" || s === "paid") return "active";
  if (s === "closed") return "done";
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
    { id: "evidence", header: "أثر السداد" },
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
    evidence: (() => {
      const line = lineByExpenseId.get(e.id);
      if (!line) return "—";
      const parts = [
        line.paid_by ? `الدافع: ${line.paid_by}` : null,
        line.custody_movement_id ? `حركة العهدة: ${line.custody_movement_id}` : null,
        line.journal_entry_id ? `القيد: ${line.journal_entry_id}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : "—";
    })(),
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
    { id: "evidence", header: "أثر التمويل" },
  ];
  const fundingRows = detail.fundings.map((funding) => ({
    id: funding.id,
    date: fmtDate(funding.occurred_at),
    account: accountLabelById.get(funding.custody_account_id) ?? "—",
    amount: paymentRequestAmountEgp(paymentRequestAmount(funding.amount, `funding ${funding.id} amount`)),
    evidence: [
      `حركة العهدة: ${funding.custody_movement_id}`,
      `القيد: ${funding.journal_entry_id}`,
      funding.note ? `ملاحظة: ${funding.note}` : null,
    ].filter(Boolean).join(" · "),
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
        ? `أُرسل الطلب (${paymentRequestAmountEgp(gross)}) — التالي: الاعتماد التشغيلي (المالك أو المحاسب).`
        : req.status === "approved_operational"
          ? `تم الاعتماد التشغيلي — التالي: اعتماد المالك (${paymentRequestAmountEgp(gross)}).`
          : req.status === "approved_final"
            ? `اعتمده المالك — التالي: تسجيل التمويل (المتبقي ${paymentRequestAmountEgp(remainingToFund)}).`
            : req.status === "paid" && remainingToFundPositive
              ? `الطلب يحتاج استكمال التمويل — التالي: تسجيل المتبقي ${paymentRequestAmountEgp(remainingToFund)} قبل أي سداد أو إقفال.`
              : req.status === "paid" && pendingLineCount > 0
                ? `التمويل مكتمل — التالي: تأكيد سداد ${num(pendingLineCount)} بند من العهدة.`
              : req.status === "paid"
                ? "اكتمل السداد — التالي: إقفال الطلب (المالك أو المحاسب)."
                : req.status === "closed"
                  ? "اكتملت الدورة — الطلب ممول، وكل البنود مسددة، والطلب مقفل."
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
        ? `اعتماد تشغيلي (المالك أو المحاسب) — ${approvedOpByName ?? "—"}`
        : "اعتماد تشغيلي (المالك أو المحاسب)",
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

  const {
    canReceiveFunding: requestCanReceiveFunding,
    canConfirmPayment: requestCanConfirmPayment,
    canClose: requestCanClose,
  } = paymentRequestSettlementState(req.status, remainingToFund, pendingLineCount);

  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6"
      style={{ "--ink-muted": "#5f7066" } as CSSProperties}
    >
      <Breadcrumbs
        ariaLabel="المسار"
        className="no-print"
        items={[
          { id: "custody", label: "العهدة وطلبات الصرف", href: "/custody" },
          { id: "request", label: `إذن صرف رقم ${num(req.request_no)}` },
        ]}
      />

      <Entity360Header
        title={`إذن صرف رقم ${num(req.request_no)}`}
        subtitle={subtitleParts.join(" · ")}
        pills={[{ status: pillStatus(req.status), label: REQ_STATUS_AR[req.status] ?? req.status }]}
        actions={(
          <HeaderLink href="/custody">
            <WalletCards size={16} aria-hidden /> مساحة العهدة
          </HeaderLink>
        )}
      />

      <section
        data-testid="payment-request-now"
        aria-labelledby="payment-request-now-title"
        className="no-print flex flex-col gap-3 border-y py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="payment-request-now-title" className="flex items-center gap-2 text-sm font-bold">
              <CircleAlert size={17} aria-hidden /> القرار الآن
            </h2>
            <p className="mt-1 max-w-3xl text-sm font-bold">{railLead}</p>
          </div>
          <RequestLifecycle requestId={req.id} status={req.status} role={m.role} />
        </div>
        {railNotes.map((note) => (
          <p key={note} className="text-xs" style={{ color: "var(--ink-muted)" }}>{note}</p>
        ))}
      </section>

      {requestCanReceiveFunding && remainingToFundPositive && (
        <Alert
          tone="warning"
          title="تمويل مطلوب من المالك"
          description={`المتبقي تسجيله كعهدة من تمويل المالك: ${paymentRequestAmountEgp(remainingToFund)}.`}
        />
      )}
      {req.status === "paid" && !remainingToFundPositive && pendingLineCount > 0 && (
        <Alert
          tone="warning"
          title="السداد يحتاج تأكيد"
          description={`تم تسجيل تمويل المالك، ويتبقى تأكيد سداد ${num(pendingLineCount)} بند من العهدة.`}
        />
      )}

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
          <section aria-labelledby="request-facts-title" className="flex flex-col gap-2">
            <h2 id="request-facts-title" className="text-sm font-bold">أرقام القرار</h2>
            <div data-testid="payment-request-facts" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <FactItem label="إجمالي الطلب" value={paymentRequestAmountEgp(t.gross_request)} icon={<FileText size={16} aria-hidden />} />
              <FactItem label="اعتماد المالك" value={paymentRequestAmountEgp(t.approved_net_request)} icon={<ReceiptText size={16} aria-hidden />} />
              <FactItem label="تمويل مستلم" value={paymentRequestAmountEgp(t.owner_funding_received)} icon={<Landmark size={16} aria-hidden />} />
              <FactItem label="مدفوع من الطلب" value={paymentRequestAmountEgp(t.request_cash_out)} icon={<WalletCards size={16} aria-hidden />} />
              <FactItem label="المتبقي تمويله" value={paymentRequestAmountEgp(remainingToFund)} emphasis={remainingToFundPositive} icon={<CircleAlert size={16} aria-hidden />} />
            </div>
          </section>

          <section aria-labelledby="request-approval-title" className="flex flex-col gap-2">
            <h2 id="request-approval-title" className="text-sm font-bold">مسار الاعتماد</h2>
            <ApprovalChain steps={approvalSteps} ariaLabel="مسار اعتماد طلب الصرف" />
          </section>

          <section aria-labelledby="request-composition-title" className="flex flex-col gap-2">
            <h2 id="request-composition-title" className="text-sm font-bold">تكوين الطلب</h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <FactItem label="تشغيلي آجل" value={paymentRequestAmountEgp(t.operating_unpaid)} />
              <FactItem label="رأسمالي آجل" value={paymentRequestAmountEgp(t.capex_unpaid)} />
              <FactItem label="مسحوبات آجل" value={paymentRequestAmountEgp(t.drawing_unpaid)} />
              <FactItem label="تغذية عهدة" value={paymentRequestAmountEgp(t.custody_top_up)} />
            </div>
          </section>

          <Card title="الملخص حسب الفئة">
            <SimpleTable columns={catCols} rows={catRows} ariaLabel="الملخص حسب الفئة" empty="لا توجد بنود بعد" />
          </Card>
        </div>
      )}

      {tab === "expenses" && (
        <section
          role="tabpanel"
          id={tabPanelId("expenses")}
          aria-labelledby={tabId("expenses")}
          tabIndex={0}
          className="no-print flex flex-col gap-3"
        >
          <div>
            <h2 className="text-sm font-bold">بنود إذن الصرف</h2>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>افتح المصروف أو أثر السداد مباشرة بدل البحث عنه في سجل آخر.</p>
          </div>
          {requestLines.length === 0 ? (
            <EmptyState title="لم تُضف بنود لهذا الطلب بعد" />
          ) : (
            <ul data-testid="payment-request-expense-list">
              {requestLines.map((line) => {
                const e = line.expense;
                const paid = Boolean(line.paid_at);
                return (
                  <li key={line.id} className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/expenses/${e.id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
                          {e.description ?? e.category ?? "مصروف بدون بيان"}
                        </Link>
                        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          {EXPENSE_KIND_AR[e.kind] ?? "غير مصنف"} · {e.category ?? "بدون فئة"} · {e.date ? fmtDate(e.date) : "بدون تاريخ"}
                        </p>
                      </div>
                      <div className="text-end">
                        <strong className="block tabular-nums">{paymentRequestAmountEgp(paymentRequestAmount(e.total, `expense ${e.id} total`))}</strong>
                        <StatusPill status={paid ? "done" : "warning"}>{paid ? "تم السداد" : "ينتظر السداد"}</StatusPill>
                      </div>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                      الحساب: {e.account_id ? postingAccountLabelById.get(e.account_id) ?? "حساب غير معروف" : "بدون حساب"}
                      {line.paid_from_custody_account_id ? ` · من عهدة ${accountLabelById.get(line.paid_from_custody_account_id) ?? "غير معروفة"}` : ""}
                      {line.paid_at ? ` · ${fmtDate(line.paid_at)}` : ""}
                      {line.paid_by ? ` · دفع بواسطة ${line.paid_by}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {line.custody_movement_id && (
                        <Link href={`/custody/movements/${line.custody_movement_id}`} className="font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
                          فتح حركة العهدة
                        </Link>
                      )}
                      {line.journal_entry_id && (
                        <span style={{ color: "var(--ink-muted)" }}>
                          مرجع القيد <bdi dir="ltr">{line.journal_entry_id}</bdi>
                        </span>
                      )}
                      {!line.custody_movement_id && !line.journal_entry_id && (
                        <span style={{ color: "var(--ink-muted)" }}>لا يوجد أثر سداد بعد.</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "settlement" && (
        <div
          role="tabpanel"
          id={tabPanelId("settlement")}
          aria-labelledby={tabId("settlement")}
          tabIndex={0}
          className="no-print flex flex-col gap-6"
        >
          <section aria-labelledby="request-funding-step" className="flex flex-col gap-3 border-b pb-6" style={{ borderColor: "var(--line)" }}>
            <StepHeading id="request-funding-step" number={1} title="تمويل المالك" detail={`المستلم ${paymentRequestAmountEgp(t.owner_funding_received)} · المتبقي ${paymentRequestAmountEgp(remainingToFund)}`} />
            {requestCanReceiveFunding ? (
              <RecordRequestFunding requestId={req.id} accounts={accountOptions} remainingToFund={remainingToFund} />
            ) : (
              <p style={{ color: "var(--ink-muted)" }}>
                {req.status === "closed" || (req.status === "paid" && !remainingToFundPositive)
                  ? "اكتمل تمويل الطلب."
                  : "يبدأ التمويل بعد الاعتماد النهائي، ويُسجل كعهدة أولًا قبل السداد."}
              </p>
            )}
            <div>
              <h3 className="text-xs font-bold">التمويلات المسجلة</h3>
              {detail.fundings.length === 0 ? (
                <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>لا توجد تمويلات مسجلة بعد.</p>
              ) : (
                <ul data-testid="payment-request-funding-list">
                  {detail.fundings.map((funding) => (
                    <li key={funding.id} className="flex flex-wrap items-start justify-between gap-2 border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                      <div>
                        <strong>{accountLabelById.get(funding.custody_account_id) ?? "عهدة غير معروفة"}</strong>
                        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{fmtDate(funding.occurred_at)}{funding.note ? ` · ${funding.note}` : ""}</p>
                        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          <Link href={`/custody/movements/${funding.custody_movement_id}`} className="font-semibold underline underline-offset-2">
                            حركة العهدة
                          </Link>
                          {` · مرجع القيد: ${funding.journal_entry_id}`}
                        </p>
                      </div>
                      <strong className="tabular-nums">{paymentRequestAmountEgp(paymentRequestAmount(funding.amount, `funding ${funding.id} amount`))}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="request-payment-step" className="flex flex-col gap-3 border-b pb-6" style={{ borderColor: "var(--line)" }}>
            <StepHeading id="request-payment-step" number={2} title="تأكيد السداد من العهدة" detail={`${num(pendingLineCount)} بند ينتظر التأكيد`} />
            {requestCanConfirmPayment ? (
              <ConfirmRequestExpensePayment requestId={req.id} expenses={payableExpenseOptions} accounts={accountOptions} />
            ) : (
              <p style={{ color: "var(--ink-muted)" }}>
                {req.status === "closed"
                  ? "تم تأكيد سداد كل البنود."
                  : "يبدأ تأكيد السداد بعد استلام تمويل المالك بالكامل وتسجيله على العهدة."}
              </p>
            )}
          </section>

          <section aria-labelledby="request-close-step" className="flex flex-col gap-3">
            <StepHeading id="request-close-step" number={3} title="إقفال الطلب" detail="آخر خطوة بعد تمويل الطلب وتأكيد كل البنود" />
            {requestCanClose ? (
              <ClosePaymentRequestButton requestId={req.id} />
            ) : req.status === "closed" ? (
              <p style={{ color: "var(--ink-muted)" }}>الطلب مقفل.</p>
            ) : (
              <p style={{ color: "var(--ink-muted)" }}>يمكن الإقفال بعد تمويل الطلب وتأكيد سداد كل البنود.</p>
            )}
          </section>
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
              title={`${num(hiddenAvailableExpenseCount)} مصروف إضافي جاهز خارج أحدث ${num(150)} مصروفًا`}
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
    </main>
  );
}

function FactItem({ label, value, emphasis = false, icon }: {
  label: string;
  value: string;
  emphasis?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="border-s px-3 py-2" style={{ borderColor: emphasis ? "var(--warning-fg)" : "var(--line)", background: "var(--surface)" }}>
      <p className="flex items-center gap-1 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</p>
      <strong className="block text-base tabular-nums" style={{ color: emphasis ? "var(--warning-fg)" : undefined }}>{value}</strong>
    </div>
  );
}

function StepHeading({ id, number, title, detail }: { id: string; number: number; title: string; detail: string }) {
  return (
    <div>
      <h2 id={id} className="text-sm font-bold">{num(number)}. {title}</h2>
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</p>
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
