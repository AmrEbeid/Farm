import { describe, expect, it } from "vitest";
import { parseCustodyDashboardSummary } from "./custody-dashboard-summary";

const valid = {
  version: "farm-os.custody-dashboard.v1",
  accounts: [
    {
      id: "account-a",
      holder_label: "Accountant",
      holder_user_id: null,
      target_float: "2000",
      active: true,
      closing_balance: "1250.5",
    },
  ],
};

describe("custody dashboard summary", () => {
  it("reads exact text money from one account snapshot", () => {
    expect(parseCustodyDashboardSummary(valid)).toEqual([
      {
        id: "account-a",
        holder_label: "Accountant",
        holder_user_id: null,
        target_float: "2000",
        active: true,
        balance: "1250.5",
      },
    ]);
  });

  it.each([
    null,
    [],
    {},
    { ...valid, version: "wrong" },
    { ...valid, accounts: null },
    { ...valid, accounts: [null] },
    { ...valid, accounts: [{ ...valid.accounts[0], closing_balance: 10 }] },
    { ...valid, accounts: [{ ...valid.accounts[0], closing_balance: "not-money" }] },
  ])("rejects an invalid payload %#", (payload) => {
    expect(() => parseCustodyDashboardSummary(payload)).toThrow("custody dashboard summary:");
  });

  it("rejects duplicate account rows", () => {
    expect(() => parseCustodyDashboardSummary({ ...valid, accounts: [valid.accounts[0], valid.accounts[0]] }))
      .toThrow("duplicate account account-a");
  });

  it("keeps a valid amount beyond binary floating-point precision", () => {
    const [account] = parseCustodyDashboardSummary({
      ...valid,
      accounts: [{ ...valid.accounts[0], closing_balance: "123.00000000000000001" }],
    });
    expect(account.balance).toBe("123.00000000000000001");
  });

});
