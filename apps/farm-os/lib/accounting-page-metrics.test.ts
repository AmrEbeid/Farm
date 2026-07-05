import { describe, expect, it } from "vitest";
import { sumAccountSubtreeNet, type AccountTreeRow, type TrialBalanceMetricRow } from "./accounting-page-metrics";

const accounts: AccountTreeRow[] = [
  { id: "cash", code: "1000", org_id: "org-a", parent_id: null },
  { id: "capex", code: "1500", org_id: "org-a", parent_id: null },
  { id: "capex-irrigation", code: "1510", org_id: "org-a", parent_id: "capex" },
  { id: "opex", code: "5000", org_id: "org-a", parent_id: null },
  { id: "supplies", code: "5100", org_id: "org-a", parent_id: "opex" },
  { id: "fertilizer", code: "5110", org_id: "org-a", parent_id: "supplies" },
  { id: "labor", code: "5200", org_id: "org-a", parent_id: "opex" },
];

const trialBalance: TrialBalanceMetricRow[] = [
  { account_id: "cash", net: 4500 },
  { account_id: "opex", net: 25 },
  { account_id: "fertilizer", net: 1200 },
  { account_id: "labor", net: "800" },
  { account_id: "capex-irrigation", net: 3000 },
];

describe("sumAccountSubtreeNet", () => {
  it("rolls parent account KPI values up from all descendants", () => {
    expect(sumAccountSubtreeNet(accounts, trialBalance, "5000")).toBe(2025);
    expect(sumAccountSubtreeNet(accounts, trialBalance, "1500")).toBe(3000);
  });

  it("keeps childless accounts unchanged", () => {
    expect(sumAccountSubtreeNet(accounts, trialBalance, "1000")).toBe(4500);
  });

  it("returns 0 when the code is absent", () => {
    expect(sumAccountSubtreeNet(accounts, trialBalance, "9999")).toBe(0);
  });

  it("uses the requested org when duplicate account codes exist", () => {
    const multiOrgAccounts: AccountTreeRow[] = [
      { id: "wrong-root", code: "5000", org_id: "org-b", parent_id: null },
      { id: "wrong-child", code: "5110", org_id: "org-b", parent_id: "wrong-root" },
      { id: "right-root", code: "5000", org_id: "org-a", parent_id: null },
      { id: "right-child", code: "5110", org_id: "org-a", parent_id: "right-root" },
    ];
    const multiOrgTrialBalance: TrialBalanceMetricRow[] = [
      { account_id: "wrong-child", net: 99 },
      { account_id: "right-child", net: 700 },
    ];

    expect(sumAccountSubtreeNet(multiOrgAccounts, multiOrgTrialBalance, "5000", "org-a")).toBe(700);
  });

  it("does not loop forever if bad parent links create a cycle", () => {
    const cyclicAccounts: AccountTreeRow[] = [
      { id: "a", code: "A", parent_id: "b" },
      { id: "b", code: "B", parent_id: "a" },
    ];

    expect(sumAccountSubtreeNet(cyclicAccounts, [{ account_id: "a", net: 1 }, { account_id: "b", net: 2 }], "A")).toBe(3);
  });
});
