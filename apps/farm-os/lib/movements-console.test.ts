import { describe, expect, it } from "vitest";
import { groupForType, parseMovementGroup, typesForGroup } from "./movements-console";

describe("movement chip groups", () => {
  it("covers every CHECK-constraint movement type except the blocked 'transfer'", () => {
    // Mirror of the inventory_movements type CHECK (20260622000005:49-50).
    const allTypes = ["receipt", "issue", "return", "adjustment", "transfer", "loss", "expiry", "reserve", "release"];
    const ungrouped = allTypes.filter((t) => groupForType(t) === null);
    expect(ungrouped).toEqual(["transfer"]); // blocked since 20260629140248; historical rows show under «الكل»
  });

  it("puts the leakage-sensitive types together (loss/adjustment/expiry = shrink)", () => {
    expect(groupForType("loss")).toBe("shrink");
    expect(groupForType("adjustment")).toBe("shrink");
    expect(groupForType("expiry")).toBe("shrink");
  });

  it("returns are inbound, issues outbound, reserve/release earmark", () => {
    expect(groupForType("return")).toBe("in");
    expect(groupForType("receipt")).toBe("in");
    expect(groupForType("issue")).toBe("out");
    expect(groupForType("reserve")).toBe("earmark");
    expect(groupForType("release")).toBe("earmark");
  });

  it("typesForGroup round-trips groupForType and 'all' means no filter", () => {
    expect(typesForGroup("all")).toBeNull();
    for (const g of ["in", "out", "shrink", "earmark"] as const) {
      for (const t of typesForGroup(g)!) expect(groupForType(t)).toBe(g);
    }
  });

  it("unknown URL params fall back to all", () => {
    expect(parseMovementGroup("nonsense")).toBe("all");
    expect(parseMovementGroup(undefined)).toBe("all");
    expect(parseMovementGroup("shrink")).toBe("shrink");
  });
});
