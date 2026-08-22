import { describe, expect, it } from "vitest";
import { OWNER_HOME_SNAPSHOT_VERSION, parseOwnerHomeSnapshot } from "./owner-home-reads";

const orgId = "00000000-0000-0000-0000-000000000001";
const asOf = "2026-08-22";

function fixture() {
  return {
    version: OWNER_HOME_SNAPSHOT_VERSION,
    org_id: orgId,
    as_of: asOf,
    detail_limit: 2,
    authority: {
      finance_ledger: "verified", palm_registry: "verified", offshoots: "verified",
      budgets: "verified", payroll: "verified", inventory: "verified", operations: "verified",
    },
    attention: {
      pending_payment_approvals: "2", pending_agronomy_signoffs: "4",
      pending_price_sales: "1", unpaid_non_drawing_expenses: "2", pending_purchase_approvals: "3",
      overdue_purchase_requests: "4", reorder_items: "5", blocked_plan_checks: "6",
      palms_needing_attention: "7", unassigned_operations: "8",
    },
    state: {
      budget: { line_count: "2", approved: "100.50", committed: "10", actual: "20", available: "70.50" },
      inventory: { item_count: "9", reorder_count: "5", out_of_stock_count: "2" },
      operations: { active_count: "10", done_count: "4", due_week_count: "3", unassigned_count: "8" },
      palms: { palm_count: "12", attention_count: "7", active: "5", watch: "4", sick: "2", dead: "1" },
      farm_registry: { hawsha_count: "3", barhi_count: "9007199254740" },
      active_people: "11",
      offshoots: { produced: "0", used: "0", available: "0", low_per_unit: null, high_per_unit: null },
      cost_centers: { posted_center_count: "2", unallocated_cost: "0", flag_count: "0" },
      expense_follow_up: {
        non_drawing_count: "2", non_drawing_total: "9007199254740993.123456789",
        non_drawing_unknown_count: "1", owner_drawing_count: "1", owner_drawing_total: "50",
        owner_drawing_unknown_count: "0",
      },
      purchase_request_count: "7",
    },
    drivers: {
      purchase_requests: [{ id: "pr-1", code: "PR-1", status: "submitted", reason: null, needed_by: asOf }],
      budget_pressure: [],
      stock_shortages: [{ id: "item-1", name: "سماد", unit: "كجم", available: "1", threshold: "10" }],
      due_operations: [{ id: "op-1", plan_id: "plan-1", subtype: "inspection", status: "planned", planned_at: asOf, assigned: false }],
      cost_centers: [{ id: "cc-1", code: "CC-1", name: "قطاع ١", debit: "20", credit: "0", net: "20" }],
    },
  };
}

describe("parseOwnerHomeSnapshot", () => {
  it("parses exact count and money strings without coercing database precision", () => {
    const parsed = parseOwnerHomeSnapshot(fixture(), orgId, asOf);
    expect(parsed.state.budget.available).toBe("70.5");
    expect(parsed.state.expenseFollowUp.nonDrawingTotal).toBe("9007199254740993.123456789");
    expect(parsed.state.farmRegistry.barhiCount).toBe(9007199254740);
    expect(parsed.authority.palm_registry).toBe("verified");
    expect(parsed.attention.pendingPaymentApprovals).toBe(2);
    expect(parsed.drivers.stockShortages).toHaveLength(1);
  });

  it("fails closed on organization, date, count, and bounded-array corruption", () => {
    expect(() => parseOwnerHomeSnapshot({ ...fixture(), org_id: "foreign" }, orgId, asOf)).toThrow(/organization mismatch/);
    expect(() => parseOwnerHomeSnapshot({ ...fixture(), as_of: "2026-02-30" }, orgId, asOf)).toThrow(/calendar date/);
    const badCount = fixture();
    badCount.attention.reorder_items = "1.5";
    expect(() => parseOwnerHomeSnapshot(badCount, orgId, asOf)).toThrow(/exact count text/);
    const badAuthority = fixture();
    badAuthority.authority.operations = "trusted";
    expect(() => parseOwnerHomeSnapshot(badAuthority, orgId, asOf)).toThrow(/invalid authority status/);
    const missingAuthority = fixture();
    delete (missingAuthority.authority as Partial<typeof missingAuthority.authority>).budgets;
    expect(parseOwnerHomeSnapshot(missingAuthority, orgId, asOf).authority.budgets).toBe("unverified");
    const unbounded = fixture();
    unbounded.drivers.purchase_requests = Array.from({ length: 3 }, (_, i) => ({
      id: `pr-${i}`, code: `PR-${i}`, status: "submitted", reason: null, needed_by: asOf,
    }));
    expect(() => parseOwnerHomeSnapshot(unbounded, orgId, asOf)).toThrow(/bounded array/);
  });
});
