import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseExpenseDetailSnapshot } from "./expense-detail-snapshot";

const valid = {
  version: "farm-os.expense-detail.v1",
  org_id: "org-a",
  expense_id: "expense-a",
  expense: {
    id: "expense-a",
    date: "2026-08-08",
    category: "Inputs",
    description: null,
    total: "9007199254740993.123456789",
    qty: "1.25",
    unit: "kg",
    unit_price: "7205759403792794.4987654312",
    payment_method: "cash",
    status: "approved",
    payment_status: "paid_from_custody",
    kind: "operating",
    account_id: "account-a",
    cost_center_id: null,
    supplier_id: "supplier-a",
    plan_id: null,
    event_id: null,
    farm_id: null,
    sector_id: null,
    hawsha_id: null,
    supplier: { id: "supplier-a", name: "Supplier" },
    plan: null,
    farm: null,
    sector: null,
    hawsha: null,
  },
  event: null,
  account: { id: "account-a", code: "5100", name_ar: "تشغيل" },
  movements: [
    {
      id: "movement-a",
      occurred_at: "2026-08-08",
      created_at: "2026-08-08T10:00:00+00:00",
      movement_type: "صرف نقدي",
      amount_in: "0",
      amount_out: "9007199254740993.123456789",
      custody_account_id: "custody-a",
      custody_account_label: "محمد",
      payment_request_id: null,
      reversal_of: null,
      reversed_by: null,
      reversal_reason: null,
      expense_reversal_outcome: null,
    },
  ],
  request_linked: false,
};

describe("expense detail snapshot", () => {
  it("preserves exact expense, quantity, price, and movement decimals", () => {
    const parsed = parseExpenseDetailSnapshot(valid);
    expect(parsed.expense?.total).toBe("9007199254740993.123456789");
    expect(parsed.expense?.qty).toBe("1.25");
    expect(parsed.expense?.unit_price).toBe("7205759403792794.4987654312");
    expect(parsed.movements[0].amount_out).toBe("9007199254740993.123456789");
  });

  it("accepts a clean not-found response", () => {
    const parsed = parseExpenseDetailSnapshot({
      ...valid,
      expense: null,
      account: null,
      movements: [],
    });
    expect(parsed.expense).toBeNull();
  });

  it("accepts and preserves a linked event timestamp", () => {
    const parsed = parseExpenseDetailSnapshot({
      ...valid,
      expense: { ...valid.expense, event_id: "event-a" },
      event: {
        id: "event-a",
        subtype: "irrigation",
        status: "done",
        occurred_at: "2026-08-08 10:15:30+00",
        notes: null,
      },
    });
    expect(parsed.event?.occurred_at).toBe("2026-08-08 10:15:30+00");
  });

  it.each([
    null,
    {},
    { ...valid, version: "wrong" },
    { ...valid, request_linked: "no" },
    { ...valid, expense: { ...valid.expense, id: "other" } },
    { ...valid, expense: { ...valid.expense, total: 10 } },
    { ...valid, expense: { ...valid.expense, qty: "-1" } },
    { ...valid, movements: [{ ...valid.movements[0], amount_in: "1" }] },
    { ...valid, movements: [{ ...valid.movements[0], created_at: "not-a-timestamp" }] },
    { ...valid, movements: [valid.movements[0], valid.movements[0]] },
    { ...valid, expense: { ...valid.expense, supplier: null } },
    { ...valid, expense: { ...valid.expense, supplier: { id: "other", name: "Wrong" } } },
    { ...valid, expense: { ...valid.expense, plan: { id: "plan-a", type: null, period_start: null, period_end: null } } },
    { ...valid, expense: { ...valid.expense, event_id: "event-a" }, event: { id: "event-a", subtype: null, status: null, occurred_at: "2026-08-08", notes: null } },
    { ...valid, expense: { ...valid.expense, event_id: "event-a" }, event: { id: "event-a", subtype: null, status: null, occurred_at: "2026-02-30 10:00:00+00", notes: null } },
    { ...valid, expense: { ...valid.expense, event_id: "event-a" }, event: { id: "event-a", subtype: null, status: null, occurred_at: "2026-08-08 10:00:00+24", notes: null } },
    { ...valid, expense: null, account: null },
  ])("rejects malformed or inconsistent payload %#", (payload) => {
    expect(() => parseExpenseDetailSnapshot(payload)).toThrow();
  });

  it("binds expense 360 core reads and money display to the exact snapshot", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/expenses/[expenseId]/page.tsx"), "utf8");
    expect(source).toContain('sb.rpc("fn_expense_detail_snapshot"');
    expect(source).toContain("parseExpenseDetailSnapshot(snapshotRes.data)");
    expect(source).toContain('kind: "money-preserve-exact"');
    expect(source).not.toContain('.from("expenses")');
    expect(source).not.toContain('.from("custody_movements")');
    expect(source).not.toContain('.from("payment_request_lines")');
    expect(source).not.toContain("Number(expense.total)");
    expect(source).not.toContain("Number(expense.unit_price)");
    expect(source).not.toContain("Number(activePayment.amount_out)");
    const correctionSource = readFileSync(
      join(process.cwd(), "app/(app)/expenses/[expenseId]/expense-correction-control.tsx"),
      "utf8",
    );
    expect(correctionSource).toContain("total,");
    expect(correctionSource).not.toContain("Number(total)");
  });
});
