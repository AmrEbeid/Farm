import { describe, expect, it } from "vitest";
import { parseBalanceSheet } from "@/lib/balance-sheet";
import { balanceSheetPdfFilename, renderBalanceSheetPdf } from "@/lib/finance-statement-pdf";

describe("finance statement PDF rendering", () => {
  it("builds a stable balance-sheet filename", () => {
    expect(balanceSheetPdfFilename("2026-03-31")).toBe("balance-sheet-2026-03-31.pdf");
  });

  it("renders a nonblank PDF buffer with the bundled Arabic font", async () => {
    const bs = parseBalanceSheet({
      as_of: "2026-03-31",
      assets: [{ code: "1000", name_ar: "عهدة نقدية", balance: 12000 }],
      liabilities: [],
      equity: [{ code: "3000", name_ar: "تمويل المالك", balance: 10000 }],
      assets_total: 12000,
      liabilities_total: 0,
      equity_total: 10000,
      drawings_total: 0,
      net_income: 2000,
      total_equity_incl_income: 12000,
      liabilities_plus_equity: 12000,
      balanced: true,
    });

    const pdf = await renderBalanceSheetPdf({ bs, asOf: "2026-03-31", generatedOn: "2026-04-01" });

    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
