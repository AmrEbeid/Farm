import { describe, expect, it } from "vitest";
import { parseBalanceSheet } from "@/lib/balance-sheet";
import { rowsToCsv } from "@/lib/export-csv";
import { balanceSheetExportRows } from "@/lib/financial-statement-export";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("financial statement exact CSV export", () => {
  it("round-trips Arabic labels and exact decimals without JavaScript number conversion", () => {
    const statement = parseBalanceSheet({
      version: "farm-os.balance-sheet.v1",
      org_id: ORG,
      as_of: "2026-03-31",
      asset_count: "1",
      liability_count: "0",
      equity_count: "1",
      assets: [{ code: "1000", name_ar: "عهدة نقدية", balance: "9007199254740993.01", kind: null }],
      liabilities: [],
      equity: [{ code: "3100", name_ar: "مسحوبات المالك", balance: "-1234567890123456.78", kind: "drawing" }],
      assets_total: "9007199254740993.01",
      liabilities_total: "0",
      equity_total: "-1234567890123456.78",
      drawings_total: "1234567890123456.78",
      revenue_total: "10241767144864449.79",
      expense_total: "0",
      net_income: "10241767144864449.79",
      total_equity_incl_income: "9007199254740993.01",
      liabilities_plus_equity: "9007199254740993.01",
      balanced: true,
    }, ORG, "2026-03-31");
    const csv = rowsToCsv(
      balanceSheetExportRows([...statement.assets, ...statement.equity]),
      [
        { id: "code", header: "الحساب" },
        { id: "name_ar", header: "الاسم" },
        { id: "balance", header: "الرصيد" },
      ],
    );

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, asset, drawing] = csv.slice(1).split("\r\n");
    expect(header).toBe("الحساب,الاسم,الرصيد");
    expect(asset.split(",")).toEqual(["1000", "عهدة نقدية", "9007199254740993.01"]);
    expect(drawing.split(",")).toEqual(["3100", "مسحوبات المالك", "-1234567890123456.78"]);
    expect(csv).not.toContain("9007199254740992");
  });
});
