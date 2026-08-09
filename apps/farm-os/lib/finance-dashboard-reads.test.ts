import { describe, expect, it } from "vitest";
import {
  FINANCE_DASHBOARD_JOURNAL_LIMIT,
  FINANCE_DASHBOARD_ROW_LIMIT,
  financeDashboardCanReadPrivateAccounting,
  parseFinanceDashboardSnapshot,
} from "./finance-dashboard-reads";

const ORG = "21700000-0000-0000-0000-000000000001";
const USER = "21700000-0000-0000-0000-000000000002";
const MONTH_START = "2026-08-01";
const MONTH_END = "2026-09-01";
const AS_OF = "2026-08-08";

function expenseSummary() {
  return {
    org_id: ORG,
    expense_count: "3",
    month_count: "3",
    operating_count: "1",
    drawing_count: "1",
    unrouted_count: "0",
    unclassified_count: "1",
    uncentered_count: "0",
    month_non_drawing_total: "9007199254740993.123456789",
    month_non_drawing_unknown_count: "0",
    month_drawing_total: "0",
    month_drawing_unknown_count: "1",
    unpaid_operating_count: "1",
    unpaid_operating_total: "12.34",
    unpaid_operating_unknown_count: "0",
    unpaid_capex_count: "0",
    unpaid_capex_total: "0",
    unpaid_capex_unknown_count: "0",
    unpaid_drawing_count: "0",
    unpaid_drawing_total: "0",
    unpaid_drawing_unknown_count: "0",
  };
}

function ownerPayload() {
  return {
    version: "farm-os.finance-dashboard.v1",
    org_id: ORG,
    role: "owner",
    can_see_accounting: true,
    as_of: AS_OF,
    month_start: MONTH_START,
    month_end: MONTH_END,
    row_limit: FINANCE_DASHBOARD_ROW_LIMIT,
    journal_limit: FINANCE_DASHBOARD_JOURNAL_LIMIT,
    budget_authority_status: "verified",
    budget_summary: {
      budget_count: 1,
      approved: "9007199254740993.123456789",
      committed: "0.02",
      actual: "0.01",
    },
    budget_categories: [
      {
        category: "تشغيل",
        approved: "9007199254740993.123456789",
        committed: "0.02",
        actual: "0.01",
      },
    ],
    budgets: [
      {
        id: "21700000-0000-0000-0000-000000000010",
        name: "موازنة",
        category: "تشغيل",
        approved: "9007199254740993.123456789",
        committed: "0.02",
        actual: "0.01",
      },
    ],
    expense_sample_summary: {
      row_count: 2,
      operating_total: "9007199254740993.123456789",
      operating_unknown_count: 0,
      drawing_total: "0",
      drawing_unknown_count: 1,
      supplier_mismatch_count: 0,
    },
    expenses: [
      {
        id: "21700000-0000-0000-0000-000000000020",
        date: "2026-08-08",
        category: "تشغيل",
        description: "مصروف دقيق",
        total: "9007199254740993.123456789",
        kind: "operating",
        account_id: null,
        supplier_name: "مورد",
      },
      {
        id: "21700000-0000-0000-0000-000000000021",
        date: null,
        category: null,
        description: null,
        total: null,
        kind: "drawing",
        account_id: null,
        supplier_name: null,
      },
    ],
    purchase_request_sample_summary: {
      row_count: 1,
      submitted_count: 1,
      near_due_count: 1,
    },
    purchase_requests: [
      {
        id: "21700000-0000-0000-0000-000000000030",
        code: "PR-1",
        status: "submitted",
        reason: null,
        needed_by: "2026-08-09",
      },
    ],
    private: {
      custody: {
        version: "farm-os.custody-dashboard.v1",
        accounts: [
          {
            id: "21700000-0000-0000-0000-000000000040",
            holder_label: "المحاسب",
            holder_user_id: USER,
            target_float: "100",
            active: true,
            closing_balance: "90.01",
          },
        ],
      },
      expense_summary: expenseSummary(),
      open_payment_count: 1,
      ready_payment_count: 1,
      unclassified_expense_count: 1,
      journal_count: 1,
      payment_requests: [
        {
          id: "21700000-0000-0000-0000-000000000050",
          request_no: 1,
          status: "approved_final",
          period_start: "2026-08-01",
          period_end: "2026-08-08",
          approved_net_request: "9007199254740993.123456789",
        },
      ],
      unpaid_expenses: [
        {
          id: "21700000-0000-0000-0000-000000000060",
          date: "2026-08-01",
          category: "آجل",
          description: "التزام",
          total: "12.34",
          kind: "operating",
        },
      ],
      journal_entries: [
        {
          id: "21700000-0000-0000-0000-000000000070",
          entry_date: "2026-08-08",
          source_type: "expense",
          description: null,
          status: "posted",
        },
      ],
    },
  };
}

function parse(payload: unknown = ownerPayload(), role = "owner") {
  return parseFinanceDashboardSnapshot(
    payload,
    ORG,
    role,
    MONTH_START,
    MONTH_END,
    AS_OF
  );
}

describe("finance dashboard atomic snapshot", () => {
  it("preserves exact money and derives exact budget arithmetic", () => {
    const snapshot = parse();
    expect(snapshot.budgetSummary.spentOrCommitted).toBe("0.03");
    expect(snapshot.budgetSummary.available).toBe("9007199254740993.093456789");
    expect(snapshot.expenses[0].total).toBe("9007199254740993.123456789");
    expect(snapshot.private?.paymentRequests[0].approvedNetRequest).toBe(
      "9007199254740993.123456789"
    );
  });

  it("keeps unknown expense money explicit", () => {
    const snapshot = parse();
    expect(snapshot.expenseSample.drawingUnknownCount).toBe(1);
    expect(snapshot.expenses[1].total).toBeNull();
  });

  it("withholds every private and drawing field from a farm manager", () => {
    const payload = ownerPayload();
    payload.role = "farm_manager";
    payload.can_see_accounting = false;
    payload.expenses = payload.expenses.slice(0, 1);
    payload.expense_sample_summary.row_count = 1;
    payload.expense_sample_summary.drawing_total = null as never;
    payload.expense_sample_summary.drawing_unknown_count = null as never;
    payload.private = null as never;
    const snapshot = parse(payload, "farm_manager");
    expect(snapshot.private).toBeNull();
    expect(snapshot.expenseSample.drawingTotal).toBeNull();
    expect(snapshot.expenses.every((row) => row.kind !== "drawing")).toBe(true);
  });

  it.each(["owner", "accountant"])(
    "recognizes %s as a private finance role",
    (role) => {
      expect(financeDashboardCanReadPrivateAccounting(role)).toBe(true);
    }
  );

  it.each(["farm_manager", "supervisor", "unknown"])(
    "does not grant private finance reads to %s",
    (role) => {
      expect(financeDashboardCanReadPrivateAccounting(role)).toBe(false);
    }
  );

  it("rejects role and private visibility disagreement", () => {
    const payload = ownerPayload();
    payload.can_see_accounting = false;
    expect(() => parse(payload)).toThrow(
      /role and accounting visibility disagree/
    );
  });

  it("rejects a cross-organization payload", () => {
    const payload = ownerPayload();
    payload.org_id = "21700000-0000-0000-0000-000000000099";
    expect(() => parse(payload)).toThrow(/organization does not match/);
  });

  it("rejects JSON numbers at every money boundary", () => {
    const payload = ownerPayload();
    payload.budget_summary.approved = 12 as never;
    expect(() => parse(payload)).toThrow(/approved.*decimal text/);
  });

  it("rejects category totals that do not reconcile to the full budget summary", () => {
    const payload = ownerPayload();
    payload.budget_categories[0].actual = "0.02";
    expect(() => parse(payload)).toThrow(/category totals do not reconcile/);
  });

  it("rejects an incomplete bounded budget sample", () => {
    const payload = ownerPayload();
    payload.budget_summary.budget_count = 2;
    expect(() => parse(payload)).toThrow(
      /budget pressure sample is incomplete/
    );
  });

  it("rejects expense sample totals that disagree with the rows", () => {
    const payload = ownerPayload();
    payload.expense_sample_summary.operating_total = "1";
    expect(() => parse(payload)).toThrow(/operating sample does not reconcile/);
  });

  it("rejects supplier organization mismatches", () => {
    const payload = ownerPayload();
    payload.expense_sample_summary.supplier_mismatch_count = 1;
    expect(() => parse(payload)).toThrow(/expense sample is inconsistent/);
  });

  it("rejects invalid dates and stale request bounds", () => {
    const payload = ownerPayload();
    payload.as_of = "2026-08-09";
    expect(() => parse(payload)).toThrow(/requested dates do not match/);
  });

  it("rejects ready-to-pay counts above the open queue", () => {
    const payload = ownerPayload();
    payload.private.ready_payment_count = 2;
    expect(() => parse(payload)).toThrow(/ready payment count exceeds/);
  });

  it("rejects an incomplete bounded unpaid-expense sample", () => {
    const payload = ownerPayload();
    payload.private.expense_summary.unpaid_operating_count = "2";
    expect(() => parse(payload)).toThrow(
      /private detail sample is inconsistent/
    );
  });

  it("rejects an incomplete bounded journal sample", () => {
    const payload = ownerPayload();
    payload.private.journal_count = 2;
    expect(() => parse(payload)).toThrow(
      /private detail sample is inconsistent/
    );
  });

  it("rejects budget figures when authority is not verified", () => {
    const payload = ownerPayload();
    payload.budget_authority_status = "blocked";
    expect(() => parse(payload)).toThrow(
      /unverified budget data must be withheld/
    );
  });

  it("rejects duplicate row identities", () => {
    const payload = ownerPayload();
    payload.expenses.push(payload.expenses[0]);
    payload.expense_sample_summary.row_count = 3;
    expect(() => parse(payload)).toThrow(/duplicate expense id/);
  });
});
