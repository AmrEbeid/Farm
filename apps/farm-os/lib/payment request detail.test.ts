import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addPaymentRequestAmounts,
  isPositivePaymentRequestAmount,
  normalizePositivePaymentRequestAmount,
  paymentRequestAmount,
  paymentRequestAmountEgp,
  paymentRequestSettlementState,
  paymentRequestTotals,
  parsePaymentRequestDetailSnapshot,
  PAYMENT_REQUEST_DETAIL_SNAPSHOT_VERSION,
} from "./payment request detail";

const pageSource = readFileSync(
  join(process.cwd(), "app/(app)/custody/request/[requestId]/page.tsx"),
  "utf8",
);
const formSource = readFileSync(join(process.cwd(), "components/CustodyForms.tsx"), "utf8");
const actionSource = readFileSync(join(process.cwd(), "app/(app)/custody/actions.ts"), "utf8");

const totals = Object.fromEntries(
  [
    "operating_unpaid",
    "capex_unpaid",
    "drawing_unpaid",
    "post_paid_unpaid",
    "target_float",
    "current_custody",
    "custody_top_up",
    "gross_request",
    "approved_post_paid_total",
    "approved_custody_top_up",
    "approved_net_request",
    "owner_funding_received",
    "request_cash_out",
    "remaining_to_fund",
    "net_request",
  ].map((key) => [key, "0"]),
);

const ORG = "10000000-0000-4000-8000-000000000001";
const LEGACY_FARM_ORG = "00000000-0000-0000-0000-000000000001";
const REQUEST = "10000000-0000-4000-8000-000000000002";
const CUSTODY = "10000000-0000-4000-8000-000000000003";
const ACCOUNT = "10000000-0000-4000-8000-000000000004";
const LINE = "10000000-0000-4000-8000-000000000005";
const LINKED_EXPENSE = "10000000-0000-4000-8000-000000000006";
const AVAILABLE_EXPENSE = "10000000-0000-4000-8000-000000000007";
const FUNDING = "10000000-0000-4000-8000-000000000008";
const USER = "10000000-0000-4000-8000-000000000009";
const FUNDING_MOVEMENT = "10000000-0000-4000-8000-00000000000a";
const FUNDING_JOURNAL = "10000000-0000-4000-8000-00000000000b";

function snapshot() {
  return {
    version: PAYMENT_REQUEST_DETAIL_SNAPSHOT_VERSION,
    org_id: ORG,
    request_id: REQUEST,
    request: {
      id: REQUEST,
      request_no: 24,
      status: "draft",
      period_start: "2026-08-01",
      period_end: "2026-08-09",
      custody_account_id: CUSTODY,
      custody_account_label: "Holder",
      note: null,
      created_at: "2026-08-09T08:00:00+02:00",
      prepared_by: USER,
      submitted_at: null,
      approved_op_by: null,
      approved_op_at: null,
      approved_final_by: null,
      approved_final_at: null,
    },
    totals: { ...totals, gross_request: "9007199254740993.123456789" },
    organization_name: "Farm",
    lines: [{
      id: LINE,
      expense_id: LINKED_EXPENSE,
      paid_at: null,
      paid_by: null,
      paid_from_custody_account_id: null,
      custody_movement_id: null,
      journal_entry_id: null,
      expense: {
        id: LINKED_EXPENSE,
        date: "2026-08-08",
        description: "Linked",
        category: "Operating",
        total: "9007199254740993.123456789",
        payment_status: "post_paid_unpaid",
        kind: "operating",
        account_id: ACCOUNT,
      },
    }],
    fundings: [{
      id: FUNDING,
      occurred_at: "2026-08-09",
      amount: "0.123456789012345678",
      custody_account_id: CUSTODY,
      custody_movement_id: FUNDING_MOVEMENT,
      journal_entry_id: FUNDING_JOURNAL,
      note: null,
    }],
    custody_accounts: [{ id: CUSTODY, holder_label: "Holder", active: true }],
    accounts: [{
      id: ACCOUNT,
      code: "5000",
      name_ar: "Operating",
      account_type: "expense",
      kind: "operating",
      parent_id: null,
      active: true,
    }],
    actors: [{ user_id: USER, name: "Owner" }],
    available_expenses: [{
      id: AVAILABLE_EXPENSE,
      date: null,
      description: "Available",
      category: "Operating",
      total: "10.25",
      payment_status: "post_paid_unpaid",
      kind: "operating",
      account_id: ACCOUNT,
    }],
    available_expense_count: "2",
    unclassified_available_count: "1",
    available_expenses_truncated: true,
  };
}

describe("payment request detail money", () => {
  it("keeps arbitrary-precision totals as exact text", () => {
    const parsed = paymentRequestTotals({
      ...totals,
      gross_request: "9007199254740993.123456789012345678",
    });

    expect(parsed.gross_request).toBe("9007199254740993.123456789012345678");
    expect(paymentRequestAmountEgp(parsed.gross_request)).toContain("١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨");
  });

  it("fails closed when the transport already converted a numeric to Number", () => {
    expect(() => paymentRequestAmount(12.5)).toThrow("exact text");
    expect(() => paymentRequestTotals({ ...totals, net_request: 12.5 })).toThrow("exact text");
    expect(() => paymentRequestTotals({ ...totals, net_request: "not-money" })).toThrow("unreadable");
    expect(() => paymentRequestTotals({ operating_unpaid: "1" })).toThrow();
  });

  it("adds category values without floating-point drift", () => {
    expect(addPaymentRequestAmounts("9007199254740993.1", "0.2")).toBe("9007199254740993.3");
  });

  it("validates and canonicalizes positive funding input without Number", () => {
    expect(isPositivePaymentRequestAmount("0.000000000000000001")).toBe(true);
    expect(isPositivePaymentRequestAmount("0")).toBe(false);
    expect(isPositivePaymentRequestAmount("invalid")).toBe(false);
    expect(normalizePositivePaymentRequestAmount("001.2300")).toBe("1.23");
    expect(normalizePositivePaymentRequestAmount("-1")).toBeNull();
  });

  it("gates the settlement state matrix on both funding and unpaid lines", () => {
    expect(paymentRequestSettlementState("approved_final", "100", 2)).toEqual({
      canReceiveFunding: true, canConfirmPayment: false, canClose: false,
    });
    expect(paymentRequestSettlementState("paid", "1", 0)).toEqual({
      canReceiveFunding: true, canConfirmPayment: false, canClose: false,
    });
    expect(paymentRequestSettlementState("paid", "0", 2)).toEqual({
      canReceiveFunding: false, canConfirmPayment: true, canClose: false,
    });
    expect(paymentRequestSettlementState("paid", "0", 0)).toEqual({
      canReceiveFunding: false, canConfirmPayment: true, canClose: true,
    });
    expect(paymentRequestSettlementState("closed", "0", 0)).toEqual({
      canReceiveFunding: false, canConfirmPayment: false, canClose: false,
    });
    expect(() => paymentRequestSettlementState("paid", "0", -1)).toThrow("non-negative");
  });

  it("loads the page through exactly one scoped atomic snapshot", () => {
    expect(pageSource.match(/\.rpc\("fn_payment_request_detail_snapshot"/g) ?? []).toHaveLength(1);
    expect(pageSource).toContain("p_org: m.orgId");
    expect(pageSource).toContain("p_request: requestId");
    expect(pageSource).toContain("p_available_limit: 150");
    expect(pageSource).toContain("parsePaymentRequestDetailSnapshot(snapshotRes.data, m.orgId, requestId)");
    expect(pageSource).toContain("detail.availableExpensesTruncated");
    expect(pageSource).toContain("القائمة هنا لا تدّعي أنها كاملة");
    expect(pageSource).not.toContain(".from(");
    expect(pageSource).not.toContain("Promise.all");
    expect(pageSource).not.toMatch(/Number\(e\.total|Number\(funding\.amount/);

    const fundingForm = formSource.slice(
      formSource.indexOf("export function RecordRequestFunding"),
      formSource.indexOf("export function ConfirmRequestExpensePayment"),
    );
    expect(fundingForm).not.toContain("Number(");
    expect(fundingForm).toContain("amount,");
    expect(fundingForm).toContain('id="funding-date" type="date" required');
    expect(fundingForm).toContain("!occurredAt");

    const fundingAction = actionSource.slice(
      actionSource.indexOf("export async function recordPaymentRequestFunding"),
      actionSource.indexOf("export async function confirmRequestExpensePaid"),
    );
    expect(fundingAction).toContain("normalizePositivePaymentRequestAmount(input.amount)");
    expect(fundingAction).toContain("isValidDateOnly(input.occurredAt)");
    expect(fundingAction).toContain("p_amount: amount");
    expect(fundingAction).toContain("p_occurred_at: input.occurredAt");
    expect(fundingAction).not.toContain("p_occurred_at: occurredAt ?? undefined");
    expect(fundingAction).not.toContain("Number(");

    const paymentForm = formSource.slice(
      formSource.indexOf("export function ConfirmRequestExpensePayment"),
      formSource.indexOf("export function ClosePaymentRequestButton"),
    );
    expect(paymentForm).toContain('id="pay-date" type="date" required');
    expect(paymentForm).toContain("!occurredAt");

    const paymentAction = actionSource.slice(
      actionSource.indexOf("export async function confirmRequestExpensePaid"),
      actionSource.indexOf("export async function submitPaymentRequest"),
    );
    expect(paymentAction).toContain("isValidDateOnly(input.occurredAt)");
    expect(paymentAction).toContain("p_occurred_at: input.occurredAt");
    expect(paymentAction).not.toContain("p_occurred_at: occurredAt ?? undefined");
  });

  it("keeps the payment-request workspace decision-led, traceable, and mobile readable", () => {
    expect(pageSource).toContain('data-testid="payment-request-now"');
    expect(pageSource).toContain('data-testid="payment-request-facts"');
    expect(pageSource).toContain('data-testid="payment-request-expense-list"');
    expect(pageSource).toContain('data-testid="payment-request-funding-list"');
    expect(pageSource).toContain('href={`/expenses/${e.id}`}');
    expect(pageSource).toContain('href={`/custody/movements/${line.custody_movement_id}`}');
    expect(pageSource).toContain("مرجع القيد");
    expect(pageSource).toContain("المالك أو المحاسب");
    expect(pageSource).toContain("التالي: إقفال الطلب");
    expect(pageSource).toContain('if (s === "closed") return "done"');
    expect(pageSource).not.toContain('s === "paid" || s === "closed"');
    expect(pageSource).toContain("${num(150)}");
    expect(pageSource).toContain('aria-labelledby="request-funding-step"');
    expect(pageSource).toContain('aria-labelledby="request-payment-step"');
    expect(pageSource).toContain('aria-labelledby="request-close-step"');

    const expensePanel = pageSource.slice(
      pageSource.indexOf('{tab === "expenses"'),
      pageSource.indexOf('{tab === "settlement"'),
    );
    const settlementPanel = pageSource.slice(
      pageSource.indexOf('{tab === "settlement"'),
      pageSource.indexOf('{tab === "add"'),
    );
    expect(expensePanel).not.toContain("<SimpleTable");
    expect(expensePanel).not.toContain('<Link href="/accounting"');
    expect(settlementPanel).not.toContain("<SimpleTable");

    const printPackage = pageSource.slice(
      pageSource.indexOf('<section className="print-only">'),
      pageSource.indexOf('{tab === "overview"'),
    );
    expect(printPackage).toContain('ariaLabel="مسار الاعتماد والتوقيع"');
    expect(printPackage).toContain('ariaLabel="الملخص حسب الفئة"');
    expect(printPackage).toContain('ariaLabel="البنود التفصيلية للطباعة"');
    expect(printPackage).toContain('ariaLabel="التمويلات المسجلة للطباعة"');
    expect(pageSource).toContain('id: "evidence", header: "أثر السداد"');
  });

  it("parses one exact internally consistent atomic detail snapshot", () => {
    const parsed = parsePaymentRequestDetailSnapshot(snapshot(), ORG, REQUEST);

    expect(parsed.request?.request_no).toBe(24);
    expect(parsed.totals?.gross_request).toBe("9007199254740993.123456789");
    expect(parsed.lines[0]?.expense.total).toBe("9007199254740993.123456789");
    expect(parsed.fundings[0]?.amount).toBe("0.123456789012345678");
    expect(parsed.fundings[0]?.custody_movement_id).toBe(FUNDING_MOVEMENT);
    expect(parsed.fundings[0]?.journal_entry_id).toBe(FUNDING_JOURNAL);
    expect(parsed.availableExpenseCount).toBe(2);
    expect(parsed.availableExpensesTruncated).toBe(true);
  });

  it("accepts the canonical PostgreSQL UUID used by the historical farm organization", () => {
    const base = snapshot();
    const parsed = parsePaymentRequestDetailSnapshot(
      { ...base, org_id: LEGACY_FARM_ORG },
      LEGACY_FARM_ORG,
      REQUEST,
    );

    expect(parsed.orgId).toBe(LEGACY_FARM_ORG);
  });

  it("accepts only the exact empty shape for a missing request", () => {
    const empty = {
      ...snapshot(), request: null, totals: null, organization_name: null,
      lines: [], fundings: [], custody_accounts: [], accounts: [], actors: [], available_expenses: [],
      available_expense_count: "0", unclassified_available_count: "0", available_expenses_truncated: false,
    };
    expect(parsePaymentRequestDetailSnapshot(empty, ORG, REQUEST).request).toBeNull();
    expect(() => parsePaymentRequestDetailSnapshot({ ...empty, available_expense_count: "1" }, ORG, REQUEST)).toThrow("inconsistent");
  });

  it("rejects identity, money, date, and timestamp corruption", () => {
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), org_id: REQUEST }, ORG, REQUEST)).toThrow("identity mismatch");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), totals: { ...totals, gross_request: 1 } }, ORG, REQUEST)).toThrow("exact text");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), request: { ...snapshot().request, period_start: "2026-02-30" } }, ORG, REQUEST)).toThrow("ISO date");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), request: { ...snapshot().request, created_at: "not-time" } }, ORG, REQUEST)).toThrow("timestamp");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), request: { ...snapshot().request, created_at: "2026-02-30T08:00:00Z" } }, ORG, REQUEST)).toThrow("timestamp");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), request: { ...snapshot().request, created_at: "2026-08-09T25:00:00Z" } }, ORG, REQUEST)).toThrow("timestamp");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), request: { ...snapshot().request, created_at: "2026-08-09T08:00:00+15:00" } }, ORG, REQUEST)).toThrow("timestamp");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), request: { ...snapshot().request, request_no: null } }, ORG, REQUEST)).toThrow("safe integer");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), request: { ...snapshot().request, status: "unknown" } }, ORG, REQUEST)).toThrow("unsupported");
    expect(() => parsePaymentRequestDetailSnapshot({ ...snapshot(), available_expenses: [{ ...snapshot().available_expenses[0], payment_status: "paid_by_owner" }] }, ORG, REQUEST)).toThrow("invalid available expense");
  });

  it("preserves valid empty free-text fields", () => {
    const base = snapshot();
    const parsed = parsePaymentRequestDetailSnapshot({
      ...base,
      request: { ...base.request, note: "" },
      lines: [{
        ...base.lines[0],
        paid_by: "",
        expense: { ...base.lines[0].expense, description: "", category: "" },
      }],
      fundings: [{ ...base.fundings[0], note: "" }],
    }, ORG, REQUEST);

    expect(parsed.request?.note).toBe("");
    expect(parsed.lines[0]?.expense.description).toBe("");
    expect(parsed.lines[0]?.paid_by).toBe("");
    expect(parsed.fundings[0]?.note).toBe("");
  });

  it("rejects duplicate, cross-reference, overlap, and completeness corruption", () => {
    const base = snapshot();
    expect(() => parsePaymentRequestDetailSnapshot({ ...base, lines: [...base.lines, base.lines[0]] }, ORG, REQUEST)).toThrow("duplicate line id");
    expect(() => parsePaymentRequestDetailSnapshot({ ...base, lines: [{ ...base.lines[0], expense_id: AVAILABLE_EXPENSE }] }, ORG, REQUEST)).toThrow("line expense mismatch");
    expect(() => parsePaymentRequestDetailSnapshot({ ...base, available_expenses: [{ ...base.available_expenses[0], id: LINKED_EXPENSE }] }, ORG, REQUEST)).toThrow("invalid available expense");
    expect(() => parsePaymentRequestDetailSnapshot({ ...base, available_expense_count: "1", available_expenses_truncated: true }, ORG, REQUEST)).toThrow("completeness mismatch");
    expect(() => parsePaymentRequestDetailSnapshot({ ...base, fundings: [{ ...base.fundings[0], custody_account_id: ACCOUNT }] }, ORG, REQUEST)).toThrow("funding custody account missing");
  });

  it("rejects inconsistent request-line payment states", () => {
    const base = snapshot();
    expect(() => parsePaymentRequestDetailSnapshot({
      ...base,
      lines: [{ ...base.lines[0], expense: { ...base.lines[0].expense, payment_status: "paid_from_custody" } }],
    }, ORG, REQUEST)).toThrow("inconsistent line payment state");
    expect(() => parsePaymentRequestDetailSnapshot({
      ...base,
      lines: [{ ...base.lines[0], custody_movement_id: ACCOUNT }],
    }, ORG, REQUEST)).toThrow("inconsistent line payment state");
  });
});
