import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addReceivableAmounts,
  normalizePositiveReceivableAmount,
  parseOpenSaleReceivables,
  parsePendingSalePricing,
  receivableAmountEgp,
  remainingReceivable,
  saleTotal,
} from "./receivable workflow money";

describe("receivable workflow exact money", () => {
  it("accepts only positive decimal text at server-action boundaries", () => {
    expect(normalizePositiveReceivableAmount("001.2300")).toBe("1.23");
    for (const value of [0.1, BigInt(1), "0", "-1", "", "abc", null]) {
      expect(normalizePositiveReceivableAmount(value)).toBeNull();
    }
  });

  it("prices, sums, and subtracts without floating-point drift", () => {
    expect(saleTotal("0.1", "0.2")).toBe("0.02");
    expect(saleTotal("100000000000000.01", "1")).toBe("100000000000000.01");
    expect(saleTotal("0.001", "0.001")).toBeNull();
    expect(saleTotal(`0.${"1".repeat(60)}`, `0.${"1".repeat(41)}`)).toBeNull();
    expect(addReceivableAmounts(["0.1", "0.2", "100000000000000.01"])).toBe(
      "100000000000000.31",
    );
    expect(remainingReceivable("100000000000000.01", "0.01")).toBe("100000000000000");
  });

  it("requires exact text and reconciled rows from both read RPCs", () => {
    expect(parsePendingSalePricing([{ id: "s1", sale_date: "2026-08-08", crop: "برحي", qty: "0.1", unit: "كجم", buyer_name: "تاجر", delivery_note_no: 7 }])[0].qty).toBe("0.1");
    expect(parseOpenSaleReceivables([{ id: "s1", sale_date: null, crop: "برحي", buyer_name: "تاجر", total: "100000000000000.01", collected: "0.01", remaining: "100000000000000" }])[0].remaining).toBe("100000000000000");
    expect(() => parsePendingSalePricing([{ id: "s1", sale_date: null, crop: "برحي", qty: 0.1, unit: "كجم", buyer_name: "تاجر", delivery_note_no: null }])).toThrow("not exact text");
    expect(() => parseOpenSaleReceivables([{ id: "s1", sale_date: null, crop: "برحي", buyer_name: "تاجر", total: "10", collected: "2", remaining: "9" }])).toThrow("does not reconcile");
  });

  it("renders exact high-precision money", () => {
    expect(receivableAmountEgp("100000000000000.01")).toBe("١٠٠٬٠٠٠٬٠٠٠٬٠٠٠٬٠٠٠٫٠١ ج.م");
  });

  it("keeps the pricing and collection paths out of JavaScript number arithmetic", () => {
    const root = process.cwd();
    const sources = [
      "components/PriceWizard.tsx",
      "components/CollectWizard.tsx",
      "app/(app)/record/price/page.tsx",
      "app/(app)/record/collect/page.tsx",
    ].map((file) => readFileSync(join(root, file), "utf8"));
    const actions = readFileSync(join(root, "app/(app)/record/actions.ts"), "utf8");
    const actionSlice = actions.slice(actions.indexOf("export interface CollectInput"), actions.indexOf("// ── SPEC-0027 H-A"));
    const priceSlice = actions.slice(actions.indexOf("export async function finalizeSalePrice"), actions.indexOf("// ── SPEC-0027 H-B"));
    expect(`${sources.join("\n")}${actionSlice}${priceSlice}`).not.toContain("Number(");
    expect(actionSlice).toContain("p_occurred_at: cairoTodayIso()");
    expect(sources[2]).toContain('rpc("fn_pending_sale_pricing"');
    expect(sources[3]).toContain('rpc("fn_open_sale_receivables"');
  });
});
