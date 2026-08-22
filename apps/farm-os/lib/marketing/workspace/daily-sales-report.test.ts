import { describe, expect, it } from "vitest";
import {
  buildDailySalesReportPayload,
  buildDailySalesSectorLedger,
  computeDailySalesReport,
  DAILY_SALES_REPORT_DEFAULT_CHANNEL,
  dailySalesReportTitle,
  isValidExpenseItem,
  isValidSalesLine,
  readDailySalesReportPayload,
  totalExpenseAmount,
  totalLineQty,
  totalLineRevenue,
  type DailyExpenseItemInput,
  type DailySalesLineInput,
} from "./daily-sales-report";

// Hand-computed oracle scenario, reused across several describe blocks below:
//   L1 حوض البابور/تصدير  500kg @ 65ج  -> revenue 32500
//   L2 حوض البابور/محلي   300kg @ 45ج  -> revenue 13500
//   L3 حوض الجديد/""      200kg @ 50ج  -> revenue 10000  (blank channel -> defaults to "بيع")
//   E1 إيجار 1000ج، E2 نقل 500ج -> totalExpenses 1500
//   qty=1000; totalRevenue=56000; net=54500; avgGross=56; avgNet=54.5; avgCost=1.5
//   per-sector expense share is qty*avgCostPerKg (NOT a share of revenue):
//     L1: exp 750, net 31750 | L2: exp 450, net 13050 | L3: exp 300, net 9700
const ORACLE_LINES: DailySalesLineInput[] = [
  { sector: "حوض البابور", channel: "تصدير", qtyKg: 500, pricePerKg: 65 },
  { sector: "حوض البابور", channel: "محلي", qtyKg: 300, pricePerKg: 45 },
  { sector: "حوض الجديد", channel: "", qtyKg: 200, pricePerKg: 50 },
];
const ORACLE_EXPENSES: DailyExpenseItemInput[] = [
  { name: "إيجار", amount: 1000 },
  { name: "نقل", amount: 500 },
];

describe("computeDailySalesReport — oracle-matches the source's computeDailyReport()", () => {
  it("matches the exact source algebra for a representative multi-sector, multi-price day", () => {
    const r = computeDailySalesReport(ORACLE_LINES, ORACLE_EXPENSES);
    expect(r.qtyKg).toBe(1000);
    expect(r.totalRevenue).toBe(56000);
    expect(r.totalExpenses).toBe(1500);
    expect(r.netAfterExpenses).toBe(54500);
    expect(r.avgPriceGross).toBe(56);
    expect(r.avgPriceNet).toBeCloseTo(54.5, 6);
    expect(r.avgCostPerKg).toBeCloseTo(1.5, 6);
  });

  it("allocates each sale line's expense share by its OWN qty × avgCostPerKg — never by its share of revenue", () => {
    const r = computeDailySalesReport(ORACLE_LINES, ORACLE_EXPENSES);
    expect(r.sectors).toHaveLength(3);
    expect(r.sectors[0]).toMatchObject({ name: "حوض البابور", channel: "تصدير", revenueShare: 32500, expenseShare: 750, netShare: 31750 });
    expect(r.sectors[1]).toMatchObject({ name: "حوض البابور", channel: "محلي", revenueShare: 13500, expenseShare: 450, netShare: 13050 });
    expect(r.sectors[2]).toMatchObject({ name: "حوض الجديد", revenueShare: 10000, expenseShare: 300, netShare: 9700 });
    // A revenue-proportional allocation would have given L1 ~857.1, not 750 — guards against that
    // common invented-formula mistake.
    expect(r.sectors[0].expenseShare).not.toBeCloseTo((32500 / 56000) * 1500, 1);
  });

  it("sector expense/net shares sum back to the report totals (allocation is conservative)", () => {
    const r = computeDailySalesReport(ORACLE_LINES, ORACLE_EXPENSES);
    const sumExpenseShares = r.sectors.reduce((s, x) => s + x.expenseShare, 0);
    const sumNetShares = r.sectors.reduce((s, x) => s + x.netShare, 0);
    expect(sumExpenseShares).toBeCloseTo(r.totalExpenses, 6);
    expect(sumNetShares).toBeCloseTo(r.netAfterExpenses, 6);
  });

  it("defaults a blank line channel to 'بيع', exactly like the source's `channel||'بيع'`", () => {
    const r = computeDailySalesReport(ORACLE_LINES, ORACLE_EXPENSES);
    expect(r.sectors[2].channel).toBe(DAILY_SALES_REPORT_DEFAULT_CHANNEL);
  });

  it("returns a loss (negative net) day correctly, with the same algebra", () => {
    const lines: DailySalesLineInput[] = [{ sector: "حوض الجديد", channel: "محلي", qtyKg: 100, pricePerKg: 10 }];
    const expenses: DailyExpenseItemInput[] = [{ name: "إيجار", amount: 2000 }];
    const r = computeDailySalesReport(lines, expenses);
    expect(r.totalRevenue).toBe(1000);
    expect(r.totalExpenses).toBe(2000);
    expect(r.netAfterExpenses).toBe(-1000);
    expect(r.avgPriceNet).toBe(-10);
    expect(r.sectors[0].netShare).toBe(-1000);
  });

  it("returns 0 rates (not NaN/Infinity) when there are no sale lines yet", () => {
    const r = computeDailySalesReport([], [{ name: "إيجار", amount: 500 }]);
    expect(r.qtyKg).toBe(0);
    expect(r.totalRevenue).toBe(0);
    expect(r.avgPriceGross).toBe(0);
    expect(r.avgPriceNet).toBe(0);
    expect(r.avgCostPerKg).toBe(0);
    expect(r.sectors).toEqual([]);
  });

  it("totalLineQty/totalLineRevenue/totalExpenseAmount match the source's standalone helpers", () => {
    expect(totalLineQty(ORACLE_LINES)).toBe(1000);
    expect(totalLineRevenue(ORACLE_LINES)).toBe(56000);
    expect(totalExpenseAmount(ORACLE_EXPENSES)).toBe(1500);
  });
});

describe("isValidSalesLine — rejects invalid/zero lines exactly like the source's addLineItem() guard", () => {
  it("accepts a well-formed line", () => {
    expect(isValidSalesLine({ sector: "حوض البابور", channel: "تصدير", qtyKg: 500, pricePerKg: 65 })).toBe(true);
  });
  it("rejects an empty or whitespace-only sector", () => {
    expect(isValidSalesLine({ sector: "", channel: "", qtyKg: 10, pricePerKg: 5 })).toBe(false);
    expect(isValidSalesLine({ sector: "   ", channel: "", qtyKg: 10, pricePerKg: 5 })).toBe(false);
  });
  it("rejects a zero, negative, or non-finite qty", () => {
    expect(isValidSalesLine({ sector: "س", channel: "", qtyKg: 0, pricePerKg: 5 })).toBe(false);
    expect(isValidSalesLine({ sector: "س", channel: "", qtyKg: -1, pricePerKg: 5 })).toBe(false);
    expect(isValidSalesLine({ sector: "س", channel: "", qtyKg: NaN, pricePerKg: 5 })).toBe(false);
  });
  it("rejects a zero, negative, or non-finite price", () => {
    expect(isValidSalesLine({ sector: "س", channel: "", qtyKg: 10, pricePerKg: 0 })).toBe(false);
    expect(isValidSalesLine({ sector: "س", channel: "", qtyKg: 10, pricePerKg: -5 })).toBe(false);
    expect(isValidSalesLine({ sector: "س", channel: "", qtyKg: 10, pricePerKg: Infinity })).toBe(false);
  });
  it("rejects a sector name longer than the bound", () => {
    expect(isValidSalesLine({ sector: "س".repeat(121), channel: "", qtyKg: 10, pricePerKg: 5 })).toBe(false);
  });
});

describe("isValidExpenseItem — rejects invalid/zero items exactly like the source's addExpenseItem() guard", () => {
  it("accepts a well-formed item", () => {
    expect(isValidExpenseItem({ name: "إيجار", amount: 1000 })).toBe(true);
  });
  it("rejects an empty name", () => {
    expect(isValidExpenseItem({ name: "", amount: 100 })).toBe(false);
    expect(isValidExpenseItem({ name: "  ", amount: 100 })).toBe(false);
  });
  it("rejects a zero, negative, or non-finite amount", () => {
    expect(isValidExpenseItem({ name: "إيجار", amount: 0 })).toBe(false);
    expect(isValidExpenseItem({ name: "إيجار", amount: -50 })).toBe(false);
    expect(isValidExpenseItem({ name: "إيجار", amount: NaN })).toBe(false);
  });
});

describe("dailySalesReportTitle", () => {
  it("uses the entered date", () => {
    expect(dailySalesReportTitle("2026-08-22")).toBe("تقرير مبيعات يوم 2026-08-22");
  });
});

describe("buildDailySalesSectorLedger — source sectorLedger()", () => {
  it("combines repeated sectors across days and sorts by revenue", () => {
    const first = computeDailySalesReport(ORACLE_LINES, ORACLE_EXPENSES);
    const second = computeDailySalesReport(
      [{ sector: "حوض الجديد", channel: "محلي", qtyKg: 100, pricePerKg: 60 }],
      [{ name: "نقل", amount: 100 }],
    );
    const rows = buildDailySalesSectorLedger([
      { date: "2026-08-21", sectors: first.sectors },
      { date: "2026-08-22", sectors: second.sectors },
    ]);

    expect(rows.map((row) => row.name)).toEqual(["حوض البابور", "حوض الجديد"]);
    expect(rows[0]).toMatchObject({ days: 1, qtyKg: 800, revenue: 46000, expenses: 1200, net: 44800 });
    expect(rows[0].avgPrice).toBe(57.5);
    expect(rows[1]).toMatchObject({ days: 2, qtyKg: 300, revenue: 16000, expenses: 400, net: 15600 });
  });
});

describe("buildDailySalesReportPayload / readDailySalesReportPayload — round-trips through the DB payload shape", () => {
  it("preserves every field through a build → read round trip", () => {
    const result = computeDailySalesReport(ORACLE_LINES, ORACLE_EXPENSES);
    const payload = buildDailySalesReportPayload({
      date: "2026-08-22",
      seller: "م/ عبدالجليل عبيد",
      buyer: "تاجر الجملة",
      witnesses: "أحمد ماهر, عبدالرحيم",
      notes: "يوم عادي",
      lines: ORACLE_LINES,
      expenseItems: ORACLE_EXPENSES,
      result,
    });
    expect(payload.date).toBe("2026-08-22");

    const record = readDailySalesReportPayload(payload);
    expect(record.date).toBe("2026-08-22");
    expect(record.seller).toBe("م/ عبدالجليل عبيد");
    expect(record.buyer).toBe("تاجر الجملة");
    expect(record.witnesses).toBe("أحمد ماهر, عبدالرحيم");
    expect(record.notes).toBe("يوم عادي");
    expect(record.qtyKg).toBe(1000);
    expect(record.totalRevenue).toBe(56000);
    expect(record.totalExpenses).toBe(1500);
    expect(record.netAfterExpenses).toBe(54500);
    expect(record.avgPriceGross).toBe(56);
    expect(record.lines).toHaveLength(3);
    expect(record.expenseItems).toHaveLength(2);
    expect(record.sectors).toHaveLength(3);
    expect(record.sectors[0]).toMatchObject({ revenueShare: 32500, expenseShare: 750, netShare: 31750 });
  });

  it("readDailySalesReportPayload never throws on a malformed/legacy payload — falls back, not fabricates", () => {
    const record = readDailySalesReportPayload({ date: "2026-08-22" });
    expect(record.date).toBe("2026-08-22");
    expect(record.seller).toBe("");
    expect(record.lines).toEqual([]);
    expect(record.expenseItems).toEqual([]);
    expect(record.sectors).toEqual([]);
    expect(record.qtyKg).toBe(0);
    expect(record.netAfterExpenses).toBe(0);
  });

  it("ignores non-object entries inside a corrupted lines/sectors array instead of throwing", () => {
    const record = readDailySalesReportPayload({
      date: "2026-08-22",
      lines: ["not-an-object", 42, null, { sector: "حوض", channel: "بيع", qtyKg: 10, pricePerKg: 5 }],
    });
    expect(record.lines).toHaveLength(1);
    expect(record.lines[0]).toEqual({ sector: "حوض", channel: "بيع", qtyKg: 10, pricePerKg: 5 });
  });
});
