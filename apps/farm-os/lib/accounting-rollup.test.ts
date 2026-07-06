import { describe, expect, it } from "vitest";
import { subtreeNetByCode } from "./accounting-rollup";

describe("subtreeNetByCode", () => {
  it("rolls up only the requested org when duplicate account codes exist", () => {
    const accounts = [
      { id: "org-a-5000", org_id: "org-a", code: "5000", parent_id: null },
      { id: "org-a-5110", org_id: "org-a", code: "5110", parent_id: "org-a-5000" },
      { id: "org-b-5000", org_id: "org-b", code: "5000", parent_id: null },
      { id: "org-b-5110", org_id: "org-b", code: "5110", parent_id: "org-b-5000" },
    ];
    const trialBalance = [
      { account_id: "org-a-5110", net: 1200 },
      { account_id: "org-b-5110", net: 9000 },
    ];

    expect(subtreeNetByCode(accounts, trialBalance, "5000", "org-a")).toBe(1200);
  });

  it("does not loop forever on an invalid account cycle", () => {
    const accounts = [
      { id: "a", org_id: "org-a", code: "5000", parent_id: "b" },
      { id: "b", org_id: "org-a", code: "5110", parent_id: "a" },
    ];

    expect(subtreeNetByCode(accounts, [{ account_id: "a", net: 1 }, { account_id: "b", net: 2 }], "5000", "org-a")).toBe(3);
  });
});
