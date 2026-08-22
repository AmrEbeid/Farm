import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseExpenseDailySnapshot } from "./expense-daily-snapshot";

const summary = {
  expense_count: "2",
  month_count: "2",
  operating_count: "2",
  drawing_count: "0",
  unrouted_count: "1",
  unclassified_count: "0",
  uncentered_count: "0",
  month_non_drawing_total: "9007199254740993.123456789",
  month_non_drawing_unknown_count: "0",
  month_drawing_total: "0",
  month_drawing_unknown_count: "0",
  unpaid_operating_count: "0",
  unpaid_operating_total: "0",
  unpaid_operating_unknown_count: "0",
  unpaid_capex_count: "0",
  unpaid_capex_total: "0",
  unpaid_capex_unknown_count: "0",
  unpaid_drawing_count: "0",
  unpaid_drawing_total: "0",
  unpaid_drawing_unknown_count: "0",
};

const valid = {
  version: "farm-os.expense-daily.v1",
  org_id: "org-a",
  filter: "all",
  month_start: "2026-08-01",
  month_end: "2026-09-01",
  row_limit: 200,
  matching_count: "2",
  summary,
  expenses: [
    {
      id: "expense-a",
      date: "2026-08-08",
      category: "Inputs",
      description: null,
      total: "9007199254740993.123456789",
      kind: "operating",
      supplier_id: "supplier-a",
      payment_status: null,
      account_id: "account-a",
      cost_center_id: null,
    },
    {
      id: "expense-b",
      date: null,
      category: "Inputs",
      description: "Second expense",
      total: "2.5",
      kind: "operating",
      supplier_id: null,
      payment_status: null,
      account_id: "account-a",
      cost_center_id: null,
    },
  ],
  suppliers: [{ id: "supplier-a", name: "Supplier" }],
  accounts: [
    {
      id: "account-a",
      code: "5100",
      name_ar: "تشغيل",
      account_type: "expense",
      kind: "operating",
      parent_id: null,
      active: true,
    },
  ],
};

describe("expense daily snapshot", () => {
  it("preserves exact row money, counts, and picker data", () => {
    const parsed = parseExpenseDailySnapshot(valid);
    expect(parsed.expenseRows[0].total).toBe("9007199254740993.123456789");
    expect(parsed.matchingCount).toBe(2);
    expect(parsed.summary.monthNonDrawingTotal).toBe("9007199254740993.123456789");
    expect(parsed.supplierRows[0].name).toBe("Supplier");
    expect(parsed.accountRows[0].kind).toBe("operating");
  });

  it.each([
    null,
    {},
    { ...valid, version: "wrong" },
    { ...valid, filter: "invalid" },
    { ...valid, matching_count: "0" },
    { ...valid, expenses: [valid.expenses[0]] },
    { ...valid, matching_count: "1", summary: { ...summary, expense_count: "2" }, expenses: [valid.expenses[0]] },
    { ...valid, expenses: [{ ...valid.expenses[0], total: 10 }] },
    { ...valid, expenses: [{ ...valid.expenses[0], total: "-1" }] },
    { ...valid, expenses: [{ ...valid.expenses[0], date: "08/08/2026" }] },
    { ...valid, accounts: [{ ...valid.accounts[0], active: "yes" }] },
  ])("rejects malformed or inconsistent payload %#", (payload) => {
    expect(() => parseExpenseDailySnapshot(payload)).toThrow();
  });

  it("rejects duplicate identities", () => {
    expect(() =>
      parseExpenseDailySnapshot({ ...valid, expenses: [valid.expenses[0], valid.expenses[0]] }),
    ).toThrow("duplicate expense id expense-a");
  });

  it("binds the expense page to one exact snapshot without direct reads or Number money", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/expenses/page.tsx"), "utf8");
    expect(source).toContain('sb.rpc("fn_expense_daily_snapshot"');
    expect(source).toContain("parseExpenseDailySnapshot(snapshotRes.data)");
    expect(source).toContain('kind: "money-preserve-exact"');
    expect(source).toContain("snapshot.rowLimit !== EXPENSE_REGISTER_DISPLAY_CAP");
    expect(source).toContain("decimal: true");
    expect(source).not.toContain("Promise.all(");
    expect(source).not.toContain('.from("expenses")');
    expect(source).not.toContain('.from("suppliers")');
    expect(source).not.toContain('.from("accounts")');
    expect(source).not.toContain("Number(e.total)");
  });
});
