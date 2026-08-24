import { describe, expect, it } from "vitest";
import { parseBalanceSheet } from "@/lib/balance-sheet";

const ORG = "11111111-1111-4111-8111-111111111111";
const AS_OF = "2026-03-31";

function valid() {
  return {
    version: "farm-os.balance-sheet.v1",
    org_id: ORG,
    as_of: AS_OF,
    assets: [{ code: "1000", name_ar: "عهدة نقدية", balance: "12000", kind: null }],
    liabilities: [],
    equity: [{ code: "3000", name_ar: "تمويل المالك", balance: "10000", kind: null }],
    asset_count: "1",
    liability_count: "0",
    equity_count: "1",
    assets_total: "12000",
    liabilities_total: "0",
    equity_total: "10000",
    drawings_total: "0",
    revenue_total: "5000",
    expense_total: "3000",
    net_income: "2000",
    total_equity_incl_income: "12000",
    liabilities_plus_equity: "12000",
    balanced: true,
  };
}

describe("parseBalanceSheet", () => {
  it("parses exact decimal text and reconciles every accounting identity", () => {
    const bs = parseBalanceSheet(valid(), ORG, AS_OF);

    expect(bs.orgId).toBe(ORG);
    expect(bs.assets[0]).toEqual({ code: "1000", nameAr: "عهدة نقدية", balance: "12000", kind: null });
    expect(bs.assetsTotal).toBe("12000");
    expect(bs.netIncome).toBe("2000");
    expect(bs.balanced).toBe(true);
  });

  it("preserves amounts beyond JavaScript safe integer precision", () => {
    const payload = valid();
    payload.assets[0].balance = "9007199254740993.01";
    payload.equity[0].balance = "9007199254740993.01";
    payload.assets_total = "9007199254740993.01";
    payload.equity_total = "9007199254740993.01";
    payload.revenue_total = "0";
    payload.expense_total = "0";
    payload.net_income = "0";
    payload.total_equity_incl_income = "9007199254740993.01";
    payload.liabilities_plus_equity = "9007199254740993.01";

    expect(parseBalanceSheet(payload, ORG, AS_OF).assetsTotal).toBe("9007199254740993.01");
  });

  it.each([
    ["wrong version", { version: "old" }],
    ["wrong organization", { org_id: "22222222-2222-4222-8222-222222222222" }],
    ["wrong date", { as_of: "2026-04-01" }],
    ["numeric rather than exact text", { assets_total: 12000 }],
    ["malformed decimal", { assets_total: "not-money" }],
    ["line total drift", { assets_total: "11999" }],
    ["line count drift", { asset_count: "2" }],
    ["drawings total drift", { drawings_total: "1" }],
    ["net income drift", { net_income: "1999" }],
    ["accounting identity drift", { liabilities_plus_equity: "11999", balanced: false }],
    ["false balanced flag", { balanced: false }],
    ["duplicate account", { liabilities: [{ code: "1000", name_ar: "مكرر", balance: "0", kind: null }] }],
  ])("fails closed on %s", (_label, patch) => {
    expect(() => parseBalanceSheet({ ...valid(), ...patch }, ORG, AS_OF)).toThrow(/balance sheet snapshot/);
  });
});
