import { describe, expect, it } from "vitest";
import {
  hrefForLinkedTarget,
  labelForLinkedTarget,
  linkedTargetKey,
  mergeLinkedPlans,
  planFromOperation,
  type LinkedOperation,
  type LinkedTargetLabel,
} from "./linked-work-context";

function op(overrides: Partial<LinkedOperation>): LinkedOperation {
  return {
    id: "op-1",
    plan_id: "plan-1",
    subtype: "inspection",
    target_type: "hawsha",
    target_id: "hawsha-1",
    planned_at: "2026-07-04",
    ends_on: null,
    est_cost: 100,
    status: "planned",
    responsible_person_id: null,
    plan: {
      id: "plan-1",
      type: "weekly",
      period_start: "2026-07-01",
      period_end: "2026-07-07",
      scope_type: "sector",
      scope_id: "sector-1",
      status: "active",
    },
    ...overrides,
  };
}

describe("linked work context helpers", () => {
  it("adds operation parent plans to the 360 plan list without duplicating scoped plans", () => {
    const scopedPlan = {
      id: "plan-0",
      type: "monthly",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      scope_type: "hawsha",
      scope_id: "hawsha-1",
      status: "active",
    };

    const merged = mergeLinkedPlans([scopedPlan], [op({}), op({ id: "op-2" })]);

    expect(merged.map((plan) => plan.id)).toEqual(["plan-1", "plan-0"]);
    expect(merged.find((plan) => plan.id === "plan-1")?.scope_type).toBe("sector");
  });

  it("normalizes an embedded operation plan into a plan row", () => {
    expect(planFromOperation(op({}))?.id).toBe("plan-1");
    expect(planFromOperation(op({ plan: null }))).toBeNull();
  });

  it("resolves target labels and hrefs from stable target keys", () => {
    const labels = new Map<string, LinkedTargetLabel>([
      ["farm:*", { label: "المزرعة كلها", href: "/farm", scope: "المزرعة" }],
      ["palm:palm-1", { label: "P-001", href: "/farm/palm/palm-1", scope: "نخلة" }],
    ]);

    expect(linkedTargetKey("farm", null)).toBe("farm:*");
    expect(linkedTargetKey("palm", "palm-1")).toBe("palm:palm-1");
    expect(labelForLinkedTarget(labels, "farm", null)).toBe("المزرعة كلها");
    expect(hrefForLinkedTarget(labels, "palm", "palm-1")).toBe("/farm/palm/palm-1");
    expect(labelForLinkedTarget(labels, "line", "missing")).toBe("—");
  });
});
