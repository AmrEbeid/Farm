import { describe, expect, it } from "vitest";
import { parseAccountingPeriods } from "@/lib/accounting-periods";

const ORG = "11111111-1111-4111-8111-111111111111";

function locked(id = "11111111-1111-4111-8111-111111111112") {
  return {
    id,
    org_id: ORG,
    period_start: "2026-03-01",
    period_end: "2026-03-31",
    status: "locked",
    note: "March close",
    locked_at: "2026-04-01T10:00:00Z",
    reopened_at: null,
  };
}

describe("parseAccountingPeriods", () => {
  it("validates, sorts, and partitions the register", () => {
    const open = {
      ...locked("11111111-1111-4111-8111-111111111113"),
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      status: "open",
      reopened_at: "2026-04-02T10:00:00Z",
    };
    const register = parseAccountingPeriods([open, locked()], ORG);

    expect(register.periods.map((period) => period.periodStart)).toEqual(["2026-03-01", "2026-02-01"]);
    expect(register.locked).toHaveLength(1);
    expect(register.open).toHaveLength(1);
  });

  it.each([
    ["another organization", { org_id: "22222222-2222-4222-8222-222222222222" }],
    ["unknown status", { status: "closed" }],
    ["invalid range", { period_start: "2026-04-01" }],
    ["locked with reopen timestamp", { reopened_at: "2026-04-02T10:00:00Z" }],
    ["open without reopen timestamp", { status: "open" }],
    ["invalid timestamp", { locked_at: "yesterday" }],
  ])("fails closed on %s", (_label, patch) => {
    expect(() => parseAccountingPeriods([{ ...locked(), ...patch }], ORG)).toThrow(/accounting period register/);
  });

  it("rejects duplicate ids and overlapping locked ranges", () => {
    expect(() => parseAccountingPeriods([locked(), locked()], ORG)).toThrow(/duplicate period/);
    expect(() => parseAccountingPeriods([
      locked(),
      { ...locked("11111111-1111-4111-8111-111111111114"), period_start: "2026-03-15", period_end: "2026-04-15" },
    ], ORG)).toThrow(/locked periods overlap/);
  });
});
