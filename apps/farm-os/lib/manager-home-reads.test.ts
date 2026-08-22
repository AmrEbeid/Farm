import { describe, expect, it } from "vitest";
import { MANAGER_HOME_SNAPSHOT_VERSION, parseManagerHomeSnapshot } from "./manager-home-reads";

const orgId = "11111111-1111-1111-1111-111111111111";
const asOf = "2026-08-23";

function fixture() {
  const op = { id: "op", plan_id: "plan", plan_type: "weekly", period_start: asOf, subtype: "irrigation", status: "planned", planned_at: asOf, ends_on: null };
  return {
    version: MANAGER_HOME_SNAPSHOT_VERSION, org_id: orgId, as_of: asOf, detail_limit: 2,
    authority: { operations: "verified", inventory: "partial" },
    attention: { overdue_operations: "1", blocked_plan_checks: "2", unassigned_operations: "3", unscheduled_operations: "1", pending_agronomy_signoffs: "2", unknown_stock_items: "1", below_reorder_threshold: "4" },
    state: {
      operations: { open_count: "8", today_count: "2", overdue_count: "1", unassigned_count: "3", unscheduled_count: "1" },
      inventory: { below_threshold_count: "4", out_of_stock_count: "1", unknown_stock_count: "1" }, blocked_plan_checks: "2", pending_agronomy_signoffs: "2",
    },
    drivers: {
      priority_operations: [{ ...op, assigned: false, urgency: "today" }],
      unassigned_operations: [op],
      pending_signoffs: [op],
      blocked_checks: [{ id: "check", plan_id: "plan", plan_type: "weekly", period_start: asOf, kind: "stock" }],
      stock_below_threshold: [{ id: "item", name: "سماد", unit: "كجم", available: "2.25", threshold: "10" }],
    },
  };
}

describe("parseManagerHomeSnapshot", () => {
  it("parses exact bounded operational data", () => {
    const parsed = parseManagerHomeSnapshot(fixture(), orgId, asOf);
    expect(parsed.state.operations.todayCount).toBe(2);
    expect(parsed.authority.inventory).toBe("partial");
    expect(parsed.drivers.stockBelowThreshold[0].available).toBe("2.25");
  });

  it("fails closed on identity, dates, counts, bounds, and urgency", () => {
    expect(() => parseManagerHomeSnapshot({ ...fixture(), org_id: "foreign" }, orgId, asOf)).toThrow(/organization mismatch/);
    expect(() => parseManagerHomeSnapshot({ ...fixture(), as_of: "2026-02-30" }, orgId, asOf)).toThrow(/calendar date/);
    const badCount = fixture(); badCount.state.operations.open_count = "1.5";
    expect(() => parseManagerHomeSnapshot(badCount, orgId, asOf)).toThrow(/exact count text/);
    const unbounded = fixture(); unbounded.drivers.priority_operations = [unbounded.drivers.priority_operations[0], unbounded.drivers.priority_operations[0], unbounded.drivers.priority_operations[0]];
    expect(() => parseManagerHomeSnapshot(unbounded, orgId, asOf)).toThrow(/bounded array/);
    const badUrgency = fixture(); badUrgency.drivers.priority_operations[0].urgency = "future";
    expect(() => parseManagerHomeSnapshot(badUrgency, orgId, asOf)).toThrow(/urgency/);
    expect(() => parseManagerHomeSnapshot({ ...fixture(), authority: { operations: "trusted" } }, orgId, asOf)).toThrow(/authority/);
  });
});
