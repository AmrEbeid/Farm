import { describe, expect, it } from "vitest";
import { parseIncomeStatement } from "@/lib/income-statement";

const ORG = "11111111-1111-4111-8111-111111111111";
const START = "2026-03-01";
const END = "2026-03-31";

function valid() {
  return {
    version: "farm-os.income-statement.v1",
    org_id: ORG,
    period_start: START,
    period_end: END,
    revenue: [{ code: "4000", name_ar: "إيرادات", amount: "5000", kind: null }],
    expenses: [{ code: "5000", name_ar: "مصروفات تشغيلية", amount: "3000", kind: "operating" }],
    revenue_count: "1",
    expense_count: "1",
    revenue_total: "5000",
    expenses_total: "3000",
    operating_expenses: "3000",
    net_income: "2000",
  };
}

describe("parseIncomeStatement", () => {
  it("parses exact decimal text and reconciles lines, operating spend, and net income", () => {
    const statement = parseIncomeStatement(valid(), ORG, START, END);

    expect(statement.orgId).toBe(ORG);
    expect(statement.revenue[0]).toEqual({ code: "4000", nameAr: "إيرادات", amount: "5000", kind: null });
    expect(statement.operatingExpenses).toBe("3000");
    expect(statement.netIncome).toBe("2000");
  });

  it("preserves amounts beyond JavaScript safe integer precision", () => {
    const payload = valid();
    payload.revenue[0].amount = "9007199254740993.01";
    payload.revenue_total = "9007199254740993.01";
    payload.net_income = "9007199254737993.01";

    expect(parseIncomeStatement(payload, ORG, START, END).revenueTotal).toBe("9007199254740993.01");
  });

  it.each([
    ["wrong version", { version: "old" }],
    ["wrong organization", { org_id: "22222222-2222-4222-8222-222222222222" }],
    ["wrong start", { period_start: "2026-02-01" }],
    ["wrong end", { period_end: "2026-04-01" }],
    ["numeric rather than exact text", { revenue_total: 5000 }],
    ["malformed decimal", { revenue_total: "not-money" }],
    ["line total drift", { expenses_total: "2999" }],
    ["line count drift", { expense_count: "2" }],
    ["operating total drift", { operating_expenses: "2999" }],
    ["net income drift", { net_income: "1999" }],
    ["duplicate account", { expenses: [{ code: "4000", name_ar: "مكرر", amount: "3000", kind: "operating" }] }],
  ])("fails closed on %s", (_label, patch) => {
    expect(() => parseIncomeStatement({ ...valid(), ...patch }, ORG, START, END)).toThrow(/income statement snapshot/);
  });
});
