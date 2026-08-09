import { describe, expect, it } from "vitest";
import { subtreeNetByCode, subtreeNetByCodeExact } from "./accounting-rollup";

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

  it("rolls up exact decimal text without floating-point loss", () => {
    const accounts = [
      { id: "root", org_id: "org-a", code: "5000", parent_id: null },
      { id: "archived-middle", org_id: "org-a", code: "5100", parent_id: "root" },
      { id: "leaf-a", org_id: "org-a", code: "5110", parent_id: "archived-middle" },
      { id: "leaf-b", org_id: "org-a", code: "5120", parent_id: "root" },
    ];
    const trialBalance = [
      { account_id: "leaf-a", net: "100000000000000.01" },
      { account_id: "leaf-b", net: "0.02" },
    ];

    expect(subtreeNetByCodeExact(accounts, trialBalance, "5000", "org-a"))
      .toBe("100000000000000.03");
  });

  it("fails closed when an exact subtree contains unreadable money", () => {
    const accounts = [{ id: "root", org_id: "org-a", code: "5000", parent_id: null }];
    expect(() => subtreeNetByCodeExact(accounts, [{ account_id: "root", net: "bad" }], "5000", "org-a"))
      .toThrow("subtree contains unreadable money");
  });
});
