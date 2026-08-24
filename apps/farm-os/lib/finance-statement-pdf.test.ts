import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseBalanceSheet } from "@/lib/balance-sheet";
import { parseIncomeStatement } from "@/lib/income-statement";
import {
  balanceSheetPdfFilename,
  renderBalanceSheetPdf,
  renderStatementPackagePdf,
  statementPackagePdfFilename,
} from "@/lib/finance-statement-pdf";

const PDF_RENDER_TIMEOUT_MS = 20_000;
const ORG = "11111111-1111-4111-8111-111111111111";
const hasPdfToText = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;
const textExtractionTest = hasPdfToText ? it : it.skip;

function normalizedExtractedArabic(value: string): string {
  return value
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, "");
}

describe("finance statement PDF rendering", () => {
  it("builds a stable balance-sheet filename", () => {
    expect(balanceSheetPdfFilename("2026-03-31")).toBe("balance-sheet-2026-03-31.pdf");
  });

  it("builds a stable statement-package filename", () => {
    expect(statementPackagePdfFilename("2026-03-01", "2026-03-31", "2026-03-31")).toBe(
      "finance-statements-2026-03-01-to-2026-03-31-as-of-2026-03-31.pdf",
    );
  });

  it("renders a nonblank PDF buffer with the bundled Arabic font", async () => {
    const bs = parseBalanceSheet({
      version: "farm-os.balance-sheet.v1",
      org_id: ORG,
      as_of: "2026-03-31",
      asset_count: "1",
      liability_count: "0",
      equity_count: "1",
      assets: [{ code: "1000", name_ar: "عهدة نقدية", balance: "12000", kind: null }],
      liabilities: [],
      equity: [{ code: "3000", name_ar: "تمويل المالك", balance: "10000", kind: null }],
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
    }, ORG, "2026-03-31");

    const pdf = await renderBalanceSheetPdf({ bs, asOf: "2026-03-31", generatedOn: "2026-04-01" });

    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  }, PDF_RENDER_TIMEOUT_MS);

  it("renders a combined income-statement and balance-sheet PDF package", async () => {
    const incomeStatement = parseIncomeStatement({
      version: "farm-os.income-statement.v1",
      org_id: ORG,
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      revenue_count: "1",
      expense_count: "1",
      revenue: [{ code: "4000", name_ar: "مبيعات البلح", amount: "8000", kind: null }],
      expenses: [{ code: "5100", name_ar: "مصروفات تشغيل", amount: "6000", kind: "operating" }],
      revenue_total: "8000",
      expenses_total: "6000",
      operating_expenses: "6000",
      net_income: "2000",
    }, ORG, "2026-03-01", "2026-03-31");
    const balanceSheet = parseBalanceSheet({
      version: "farm-os.balance-sheet.v1",
      org_id: ORG,
      as_of: "2026-03-31",
      asset_count: "1",
      liability_count: "0",
      equity_count: "1",
      assets: [{ code: "1000", name_ar: "عهدة نقدية", balance: "12000", kind: null }],
      liabilities: [],
      equity: [{ code: "3000", name_ar: "تمويل المالك", balance: "10000", kind: null }],
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
    }, ORG, "2026-03-31");

    const pdf = await renderStatementPackagePdf({
      incomeStatement,
      balanceSheet,
      start: "2026-03-01",
      end: "2026-03-31",
      asOf: "2026-03-31",
      generatedOn: "2026-04-01",
    });

    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1500);

    if (hasPdfToText) {
      const extraction = spawnSync("pdftotext", ["-layout", "-", "-"], {
        input: pdf,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      const normalizedArabic = normalizedExtractedArabic(extraction.stdout);
      expect(extraction.status).toBe(0);
      expect(normalizedArabic).toContain("قائمةالدخل");
      expect(normalizedArabic).toContain("مبيعاتالبلح");
      expect(normalizedArabic).toContain("مصروفاتتشغيل");
      expect(normalizedArabic).toContain("قائمةالمركزالمالي");
    }
  }, PDF_RENDER_TIMEOUT_MS);

  textExtractionTest("preserves statement labels, account codes, and exact money in extracted PDF text", async () => {
    const bs = parseBalanceSheet({
      version: "farm-os.balance-sheet.v1",
      org_id: ORG,
      as_of: "2026-03-31",
      asset_count: "1",
      liability_count: "0",
      equity_count: "1",
      assets: [{ code: "1000", name_ar: "عهدة نقدية", balance: "9007199254740993.01", kind: null }],
      liabilities: [],
      equity: [{ code: "3000", name_ar: "تمويل المالك", balance: "9007199254740993.01", kind: null }],
      assets_total: "9007199254740993.01",
      liabilities_total: "0",
      equity_total: "9007199254740993.01",
      drawings_total: "0",
      revenue_total: "0",
      expense_total: "0",
      net_income: "0",
      total_equity_incl_income: "9007199254740993.01",
      liabilities_plus_equity: "9007199254740993.01",
      balanced: true,
    }, ORG, "2026-03-31");
    const pdf = await renderBalanceSheetPdf({ bs, asOf: "2026-03-31", generatedOn: "2026-04-01" });
    const extraction = spawnSync("pdftotext", ["-layout", "-", "-"], {
      input: pdf,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });

    expect(extraction.status).toBe(0);
    expect(extraction.stderr).toBe("");
    expect(extraction.stdout).toContain("1000");
    expect(extraction.stdout).toContain("3000");
    const normalizedArabic = normalizedExtractedArabic(extraction.stdout);
    expect(normalizedArabic).toContain("قائمةالمركزالمالي");
    expect(normalizedArabic).toContain("الموارد");
    expect(normalizedArabic).toContain("عهدةنقدية");
    expect(normalizedArabic).toContain("تمويلالمالك");
    expect(extraction.stdout).toContain("٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٬٩٩٣٫٠١");
  }, PDF_RENDER_TIMEOUT_MS);

  textExtractionTest("preserves negative exact money and renders hostile account text literally", async () => {
    const hostileName = "A<script>window.__farmPwned=true</script>Z";
    const bs = parseBalanceSheet({
      version: "farm-os.balance-sheet.v1",
      org_id: ORG,
      as_of: "2026-03-31",
      asset_count: "1",
      liability_count: "0",
      equity_count: "1",
      assets: [{ code: "1000", name_ar: hostileName, balance: "-9007199254740993.01", kind: null }],
      liabilities: [],
      equity: [{ code: "3000", name_ar: "عجز متراكم", balance: "-9007199254740993.01", kind: null }],
      assets_total: "-9007199254740993.01",
      liabilities_total: "0",
      equity_total: "-9007199254740993.01",
      drawings_total: "0",
      revenue_total: "0",
      expense_total: "0",
      net_income: "0",
      total_equity_incl_income: "-9007199254740993.01",
      liabilities_plus_equity: "-9007199254740993.01",
      balanced: true,
    }, ORG, "2026-03-31");
    const pdf = await renderBalanceSheetPdf({ bs, asOf: "2026-03-31", generatedOn: "2026-04-01" });
    const extraction = spawnSync("pdftotext", ["-layout", "-", "-"], {
      input: pdf,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(extraction.status).toBe(0);
    expect(extraction.stderr).toBe("");
    expect(extraction.stdout).toContain("٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٬٩٩٣٫٠١");
    expect(extraction.stdout).toContain("(");
    expect(extraction.stdout).toContain(")");
    const normalizedArabic = normalizedExtractedArabic(extraction.stdout);
    expect(normalizedArabic).toContain("<script>window.__farmPwned=true</script>");
    expect(normalizedArabic).toContain("عجزمتراكم");
  }, PDF_RENDER_TIMEOUT_MS);
});
