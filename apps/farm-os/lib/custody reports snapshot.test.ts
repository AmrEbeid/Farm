import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCustodyReportsSnapshot } from "./custody reports snapshot";

const holder = {
  id: "holder-a",
  holder_label: "المحاسب",
  target_float: "1000000000000000.123456",
  active: true,
  opening_balance: "900000000000000.01",
  amount_in: "0.02",
  amount_out: "0",
  closing_balance: "900000000000000.03",
  movement_count: 1,
};

const movement = {
  id: "movement-a",
  custody_account_id: "holder-a",
  holder_label: "المحاسب",
  occurred_at: "2026-08-08",
  movement_type: "تمويل",
  amount_in: "0.02",
  amount_out: "0",
  net: "0.02",
  expense_id: null,
  payment_request_id: "request-a",
  transfer_group_id: null,
  note: null,
};

const cashExpense = {
  id: "expense-cash",
  expense_date: "2026-08-08",
  category: "عمالة",
  description: null,
  total: "100.01",
  kind: "operating",
  paid_by: null,
  movement_id: "movement-a",
  paid_at: "2026-08-08",
  holder_label: "المحاسب",
  payment_request_id: "request-a",
  missing_movement: false,
};

const obligation = {
  id: "expense-unpaid",
  expense_date: "2026-06-01",
  category: null,
  description: "فاتورة",
  total: "50.02",
  kind: "capex",
  age_days: 68,
  aging_bucket: "60+",
  payment_request_id: null,
  request_no: null,
  request_status: null,
};

const funding = {
  id: "funding-a",
  payment_request_id: "request-a",
  request_no: 7,
  request_status: "approved_final",
  request_period_start: "2026-08-01",
  request_period_end: "2026-08-08",
  holder_label: "المحاسب",
  occurred_at: "2026-08-08",
  amount: "700000000000000.123456",
  note: null,
  approved_net_request: "900.03",
  gross_request: "1000",
  owner_funding_received: "100.01",
  remaining_to_fund: "800.02",
};

const summary = {
  holder_count: 1,
  movement_count: 1,
  cash_count: 1,
  cash_missing_movement_count: 0,
  cash_unknown_total_count: 0,
  obligation_count: 1,
  obligation_unknown_total_count: 0,
  obligation_unknown_date_count: 0,
  over_30_count: 1,
  over_30_unknown_total_count: 0,
  funding_count: 1,
  opening_total: "900000000000000.01",
  period_in: "0.02",
  period_out: "0",
  closing_total: "900000000000000.03",
  cash_total: "100.01",
  obligation_total: "50.02",
  over_30_total: "50.02",
  funding_total: "700000000000000.123456",
};

const valid = {
  version: "farm-os.custody-reports.v1",
  org_id: "org-a",
  period_start: "2026-08-01",
  period_end: "2026-08-08",
  as_of: "2026-08-08",
  row_limit: 400,
  relationship_mismatch_count: 0,
  summary,
  holders: [holder],
  movements: [movement],
  cash_expenses: [cashExpense],
  obligations: [obligation],
  fundings: [funding],
};

const parse = (value: unknown) => parseCustodyReportsSnapshot(
  value,
  "org-a",
  "2026-08-01",
  "2026-08-08",
  "2026-08-08",
);

describe("custody reports snapshot", () => {
  it("preserves exact report money without JavaScript number conversion", () => {
    const parsed = parse(valid);
    expect(parsed.holders[0]?.targetFloat).toBe("1000000000000000.123456");
    expect(parsed.summary.fundingTotal).toBe("700000000000000.123456");
    expect(parsed.fundings[0]?.remainingToFund).toBe("800.02");
  });

  it.each([
    null,
    {},
    { ...valid, version: "wrong" },
    { ...valid, org_id: "org-b" },
    { ...valid, period_end: "2026-02-30" },
    { ...valid, period_start: "2026-08-09" },
    { ...valid, row_limit: 0 },
    { ...valid, relationship_mismatch_count: 1 },
    { ...valid, summary: { ...summary, cash_total: 100.01 } },
    { ...valid, summary: { ...summary, closing_total: "1" } },
    { ...valid, summary: { ...summary, over_30_count: 2 } },
  ])("rejects malformed, inexact, or tenant-drift payload %#", (payload) => {
    expect(() => parse(payload)).toThrow("custody reports snapshot:");
  });

  it("rejects incomplete or duplicate bounded samples", () => {
    const twoMovements = { ...valid, summary: { ...summary, movement_count: 2 }, holders: [{ ...holder, movement_count: 2 }] };
    expect(() => parse(twoMovements))
      .toThrow("movement sample is incomplete");
    expect(() => parse({ ...twoMovements, movements: [movement, movement] }))
      .toThrow("duplicate movement movement-a");
  });

  it("accepts a bounded holder sample without pretending its rows reconcile full totals", () => {
    const bounded = {
      ...valid,
      row_limit: 1,
      summary: { ...summary, holder_count: 2 },
    };
    expect(parse(bounded).holders).toHaveLength(1);
  });

  it("rejects impossible movement, cash, obligation, and funding states", () => {
    expect(() => parse({ ...valid, movements: [{ ...movement, net: "2" }] })).toThrow("movement net is inconsistent");
    expect(() => parse({ ...valid, cash_expenses: [{ ...cashExpense, missing_movement: true }] })).toThrow("cash movement state is inconsistent");
    expect(() => parse({ ...valid, obligations: [{ ...obligation, age_days: 67 }] })).toThrow("obligation age is inconsistent");
    expect(() => parse({ ...valid, obligations: [{ ...obligation, expense_date: "2026-08-09", age_days: 0, aging_bucket: "0-29" }] }))
      .toThrow("obligation age is inconsistent");
    expect(() => parse({ ...valid, fundings: [{ ...funding, remaining_to_fund: "1" }] })).toThrow("funding remaining amount is inconsistent");
    expect(() => parse({ ...valid, fundings: [{ ...funding, request_no: 0 }] })).toThrow('field "request_no" must be positive');
    expect(() => parse({ ...valid, fundings: [{ ...funding, amount: "0" }] })).toThrow('field "amount" is not a valid decimal');
    expect(() => parse({ ...valid, obligations: [{ ...obligation, payment_request_id: "request-a", request_no: 0, request_status: "draft" }] }))
      .toThrow('field "request_no" must be positive');
  });

  it("accepts and counts unknown obligation dates and amounts without converting them to zero", () => {
    const unknown = {
      ...valid,
      summary: {
        ...summary,
        obligation_unknown_total_count: 1,
        obligation_unknown_date_count: 1,
        over_30_count: 0,
        over_30_unknown_total_count: 0,
        obligation_total: "0",
        over_30_total: "0",
      },
      obligations: [{ ...obligation, expense_date: null, total: null, age_days: null, aging_bucket: "unknown" }],
    };
    const parsed = parse(unknown);
    expect(parsed.obligations[0]?.total).toBeNull();
    expect(parsed.obligations[0]?.ageDays).toBeNull();
  });

  it("binds the page to one exact RPC, exact table values, Cairo dates, and honest truncation", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/finance/custody-reports/page.tsx"), "utf8");
    expect(source.match(/sb\.rpc\("fn_custody_reports_snapshot"/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/fn_(?:custody_ledger_report|custody_cash_expense_report|unpaid_obligations_report|owner_funding_report)/);
    expect(source).not.toMatch(/Number\(row\./);
    expect(source).toContain('kind: "money-preserve-exact"');
    expect(source).toContain("cairoTodayIso()");
    expect(source).toContain("summary.movementCount > snapshot.rowLimit");
    expect(source).toContain("holderTruncated ? undefined");
    expect(source).toContain("movementTruncated ? undefined");
    expect(source).toContain("obligationTruncated ? undefined");
  });
});
