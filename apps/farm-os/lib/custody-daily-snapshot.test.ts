import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCustodyDailySnapshot } from "./custody-daily-snapshot";

const expenseSummary = {
  expense_count: 1,
  month_count: 1,
  operating_count: 1,
  drawing_count: 0,
  unrouted_count: 0,
  unclassified_count: 0,
  uncentered_count: 0,
  month_non_drawing_total: "10",
  month_non_drawing_unknown_count: 0,
  month_drawing_total: "0",
  month_drawing_unknown_count: 0,
  unpaid_operating_count: 1,
  unpaid_operating_total: "10",
  unpaid_operating_unknown_count: 0,
  unpaid_capex_count: 0,
  unpaid_capex_total: "0",
  unpaid_capex_unknown_count: 0,
  unpaid_drawing_count: 0,
  unpaid_drawing_total: "0",
  unpaid_drawing_unknown_count: 0,
};

const valid = {
  version: "farm-os.custody-daily.v1",
  org_id: "org-a",
  request_filter: "awaiting",
  movement_limit: 15,
  request_limit: 200,
  movement_count: 1,
  all_request_count: 3,
  awaiting_request_count: 1,
  settled_request_count: 1,
  selected_request_count: 1,
  accounts: [
    {
      id: "account-a",
      holder_label: "Accountant",
      holder_user_id: null,
      target_float: "9007199254740993.123456789",
      active: true,
      closing_balance: "0.01",
    },
  ],
  movements: [
    {
      id: "movement-a",
      occurred_at: "2026-08-08",
      movement_type: "Funding",
      amount_in: "9007199254740993.123456789",
      amount_out: "0",
      custody_account_id: "account-a",
      holder_label: "Accountant",
      reversal_of: null,
      reversed_by: null,
    },
  ],
  requests: [
    {
      id: "request-a",
      request_no: 7,
      status: "submitted",
      period_start: "2026-08-01",
      period_end: null,
      created_at: "2026-08-08T10:00:00+00:00",
    },
  ],
  expense_summary: expenseSummary,
};

describe("custody daily snapshot", () => {
  it("preserves exact money and bounded full-table counts", () => {
    const parsed = parseCustodyDailySnapshot(valid);
    expect(parsed.accountRows[0].targetFloat).toBe("9007199254740993.123456789");
    expect(parsed.movementRows[0].amountIn).toBe("9007199254740993.123456789");
    expect(parsed.selectedRequestCount).toBe(1);
    expect(parsed.expenseSummary.unpaidOperatingTotal).toBe("10");
  });

  it("surfaces an anomalous negative custody balance without hiding the ledger truth", () => {
    const parsed = parseCustodyDailySnapshot({
      ...valid,
      accounts: [{ ...valid.accounts[0], closing_balance: "-0.01" }],
    });
    expect(parsed.accountRows[0].balance).toBe("-0.01");
  });

  it.each([
    null,
    {},
    { ...valid, version: "wrong" },
    { ...valid, request_filter: "draft" },
    { ...valid, movements: [{ ...valid.movements[0], amount_in: 10 }] },
    { ...valid, movements: [{ ...valid.movements[0], occurred_at: "08/08/2026" }] },
    { ...valid, requests: [{ ...valid.requests[0], created_at: "not-a-date" }] },
    { ...valid, selected_request_count: 2 },
    { ...valid, movement_limit: 0 },
    { ...valid, request_limit: 0 },
    { ...valid, expense_summary: null },
  ])("rejects malformed or inconsistent payload %#", (payload) => {
    expect(() => parseCustodyDailySnapshot(payload)).toThrow();
  });

  it("rejects duplicate identities", () => {
    expect(() =>
      parseCustodyDailySnapshot({ ...valid, movements: [valid.movements[0], valid.movements[0]] }),
    ).toThrow("duplicate movement id movement-a");
  });

  it("binds the custody page to one snapshot RPC and no direct reads", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/custody/page.tsx"), "utf8");
    expect(source).toContain('sb.rpc("fn_custody_daily_snapshot"');
    expect(source).toContain("parseCustodyDailySnapshot(snapshotRes.data)");
    expect(source).not.toContain("Promise.all(");
    expect(source).not.toContain('.from("custody_movements")');
    expect(source).not.toContain('.from("payment_requests")');
    expect(source).not.toContain('sb.rpc("fn_expense_register_summary"');
    expect(source).not.toMatch(/Number\([^)]*amount_(?:in|out)/);
  });
});
