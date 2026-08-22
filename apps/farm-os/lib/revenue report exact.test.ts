import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exactRevenueChartRows, parseExactRevenueReport } from "./revenue report exact";

const EXACT = "100000000000000.01";

function fixture(): Record<string, unknown> {
  return {
    period_start: "2026-08-01",
    period_end: "2026-08-08",
    as_of: "2026-08-08",
    finalized_revenue: EXACT,
    period_collections: "0.01",
    outstanding_total: "100000000000000",
    over_30_amount: "0",
    over_30_count: 0,
    pending_count: 1,
    pending_qty: "0.001",
    sales: [
      {
        sale_id: "sale-1",
        report_date: "2026-08-08",
        sale_date: "2026-08-08",
        delivery_date: null,
        crop: "برحي",
        season: "2026",
        qty: EXACT,
        unit: "كجم",
        unit_price: "1",
        total: EXACT,
        price_status: "finalized",
        payment_status: "partially_collected",
        buyer_id: "buyer-1",
        buyer_name: "تاجر",
        buyer_type: "trader",
        cost_center_id: null,
        cost_center_code: null,
        cost_center_name: null,
        farm_name: null,
        sector_name: null,
        hawsha_name: null,
        collected_to_as_of: "0.01",
        collected_in_period: "0.01",
        outstanding: "100000000000000",
      },
    ],
    by_buyer: [
      {
        buyer_id: "buyer-1",
        buyer_name: "تاجر",
        buyer_type: "trader",
        sale_count: 1,
        pending_count: 0,
        qty: EXACT,
        finalized_revenue: EXACT,
        collected_in_period: "0.01",
        collected_to_as_of: "0.01",
        outstanding: "100000000000000",
      },
    ],
    by_crop_season: [
      {
        crop: "برحي",
        season: "2026",
        sale_count: 1,
        pending_count: 0,
        qty: EXACT,
        finalized_revenue: EXACT,
        collected_in_period: "0.01",
        outstanding: "100000000000000",
      },
    ],
    ar_rows: [
      {
        sale_id: "sale-1",
        report_date: "2026-08-08",
        buyer_id: "buyer-1",
        buyer_name: "تاجر",
        buyer_type: "trader",
        crop: "برحي",
        season: "2026",
        total: EXACT,
        collected_to_as_of: "0.01",
        outstanding: "100000000000000",
        age_days: 0,
        aging_bucket: "0-29",
        payment_status: "partially_collected",
      },
    ],
    collections: [
      {
        collection_id: "collection-1",
        sale_id: "sale-1",
        occurred_at: "2026-08-08",
        amount: "0.01",
        buyer_name: "تاجر",
        crop: "برحي",
        season: "2026",
        collected_by: null,
        note: null,
        journal_entry_id: "journal-1",
      },
    ],
  };
}

describe("exact revenue report transport", () => {
  it("preserves exact money and quantity strings beyond JavaScript safe precision", () => {
    const report = parseExactRevenueReport(fixture());
    expect(report.finalized_revenue).toBe(EXACT);
    expect(report.sales[0]?.qty).toBe(EXACT);
    expect(report.by_buyer[0]?.finalized_revenue).toBe(EXACT);
    expect(report.by_crop_season[0]?.qty).toBe(EXACT);
    expect(report.ar_rows[0]?.total).toBe(EXACT);
    expect(report.collections[0]?.amount).toBe("0.01");
  });

  it("rejects a JSON number where exact money text is required", () => {
    const value = fixture();
    value.finalized_revenue = 100000000000000.01;
    expect(() => parseExactRevenueReport(value)).toThrow("finalized_revenue is not exact text");
  });

  it("rejects unsafe or fractional counts", () => {
    const value = fixture();
    value.pending_count = 1.5;
    expect(() => parseExactRevenueReport(value)).toThrow("pending_count is not a safe count");
  });

  it("rejects missing report arrays instead of presenting an empty report", () => {
    const value = fixture();
    delete value.sales;
    expect(() => parseExactRevenueReport(value)).toThrow("sales is not an array");
  });

  it("builds a complete chart only when every displayed row round-trips safely", () => {
    expect(exactRevenueChartRows([
      { label: "آمن", finalizedRevenue: "123.5", outstanding: "10" },
      { label: "آمن أيضًا", finalizedRevenue: "50", outstanding: "0.25" },
    ])).toEqual([
      { label: "آمن", "إيراد مسعّر": 123.5, "ذمم قائمة": 10 },
      { label: "آمن أيضًا", "إيراد مسعّر": 50, "ذمم قائمة": 0.25 },
    ]);
  });

  it("degrades the entire chart when one mixed row is unsafe", () => {
    expect(exactRevenueChartRows([
      { label: "آمن", finalizedRevenue: "123", outstanding: "10" },
      { label: "كبير", finalizedRevenue: EXACT, outstanding: "100000000000000" },
    ])).toBeNull();
  });

  it("keeps the page on the exact RPC and exact table kinds", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/(app)/finance/revenue-reports/page.tsx"),
      "utf8",
    );
    expect(source).toContain('sb.rpc("fn_revenue_sales_report_exact"');
    expect(source).not.toContain('sb.rpc("fn_revenue_sales_report"');
    expect(source).toContain('kind: "money-preserve-exact", numeric: true, decimal: true');
    expect(source).toContain('kind: "decimal-exact", numeric: true, decimal: true');
    expect(source).toContain("تعذر رسم قيم العملاء الكبيرة بدقة");
    expect(source).not.toContain("normalizeReport(");
    expect(source).not.toMatch(/\bNumber\(/);

    const tableSource = readFileSync(
      resolve(process.cwd(), "components/SimpleTableClient.tsx"),
      "utf8",
    );
    expect(tableSource).toContain('case "money-preserve-exact"');
    expect(tableSource).toContain("formatDecimalArabic(decimal, Math.max(2, scale))");
  });
});
