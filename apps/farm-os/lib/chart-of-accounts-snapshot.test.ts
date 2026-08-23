import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChartOfAccountsSnapshot } from "./chart-of-accounts-snapshot";

const account = {
  id: "account-root",
  parent_id: null,
  code: "5000",
  name_ar: "مصروفات تشغيلية",
  account_type: "expense",
  normal_balance: "debit",
  kind: "operating",
  active: true,
  is_system: true,
  sort_order: 10,
  child_count: "0",
  active_child_count: "0",
  posting_count: "2",
  debit: "100000000000000.01",
  credit: "0",
  balance: "100000000000000.01",
};

const valid = {
  version: "farm-os.chart-of-accounts.v1",
  org_id: "org-a",
  can_write: true,
  totals: {
    account_count: "1",
    active_count: "1",
    archived_count: "0",
    posting_leaf_count: "1",
    operating_balance: "100000000000000.01",
    drawing_balance: "0",
    capex_balance: "0",
  },
  accounts: [account],
};

describe("chart of accounts snapshot", () => {
  it("preserves exact decimal text and capability", () => {
    const parsed = parseChartOfAccountsSnapshot(valid, "org-a");
    expect(parsed.canWrite).toBe(true);
    expect(parsed.accounts[0].balance).toBe("100000000000000.01");
    expect(parsed.totals.operatingBalance).toBe("100000000000000.01");
  });

  it("fails closed on version, scope, shape, and decimal drift", () => {
    expect(() => parseChartOfAccountsSnapshot({ ...valid, version: "v2" }, "org-a")).toThrow("version");
    expect(() => parseChartOfAccountsSnapshot(valid, "org-b")).toThrow("active organization");
    expect(() => parseChartOfAccountsSnapshot({ ...valid, leaked: true }, "org-a")).toThrow("shape");
    expect(() => parseChartOfAccountsSnapshot({ ...valid, accounts: [{ ...account, debit: 10 }] }, "org-a"))
      .toThrow("decimal text");
  });

  it("rejects broken hierarchy and non-reconciling totals", () => {
    expect(() => parseChartOfAccountsSnapshot({
      ...valid,
      accounts: [{ ...account, parent_id: "missing" }],
    }, "org-a")).toThrow("parent is missing");
    expect(() => parseChartOfAccountsSnapshot({
      ...valid,
      totals: { ...valid.totals, active_count: "0" },
    }, "org-a")).toThrow("totals do not reconcile");
    expect(() => parseChartOfAccountsSnapshot({
      ...valid,
      accounts: [{ ...account, balance: "1" }],
    }, "org-a")).toThrow("balance does not reconcile");
  });

  it("rejects cycles and hierarchy deeper than four levels", () => {
    const cyclic = {
      ...account,
      parent_id: account.id,
      child_count: "1",
      active_child_count: "1",
    };
    expect(() => parseChartOfAccountsSnapshot({
      ...valid,
      totals: { ...valid.totals, posting_leaf_count: "0", operating_balance: "0" },
      accounts: [cyclic],
    }, "org-a")).toThrow("cycle");

    const deepAccounts = Array.from({ length: 5 }, (_, index) => ({
      ...account,
      id: `account-${index}`,
      parent_id: index === 0 ? null : `account-${index - 1}`,
      code: `50${index}`,
      child_count: index === 4 ? "0" : "1",
      active_child_count: index === 4 ? "0" : "1",
      posting_count: "0",
      debit: "0",
      credit: "0",
      balance: "0",
    }));
    expect(() => parseChartOfAccountsSnapshot({
      ...valid,
      totals: {
        ...valid.totals,
        account_count: "5",
        active_count: "5",
        posting_leaf_count: "1",
        operating_balance: "0",
      },
      accounts: deepAccounts,
    }, "org-a")).toThrow("four levels");
  });

  it("binds the page to one snapshot and exact money rendering", () => {
    const page = readFileSync(join(process.cwd(), "app/(app)/finance/accounts/page.tsx"), "utf8");
    const manager = readFileSync(join(process.cwd(), "components/AccountsTreeManager.tsx"), "utf8");
    expect(page.match(/sb\.rpc\("fn_chart_of_accounts_snapshot"/g) ?? []).toHaveLength(1);
    expect(page).not.toContain('.from("v_account_rollup")');
    expect(page).not.toContain("asNumber(");
    expect(manager).toContain("egpExact(node.balance)");
    expect(manager).not.toContain('min-w-[860px]');
  });
});
