import { describe, it, expect } from "vitest";
import {
  coverageDays,
  egp,
  egpSummary,
  egpValue,
  moneyNumber,
  num,
  pct,
  sumMoney,
} from "./money";

describe("money formatters", () => {
  it("egp/num/pct guard null and NaN with an em dash", () => {
    expect(egp(null)).toBe("—");
    expect(num(undefined)).toBe("—");
    expect(pct(NaN)).toBe("—");
  });

  it("keeps unknown money values unknown instead of coercing them to zero", () => {
    expect(moneyNumber(null)).toBeNull();
    expect(moneyNumber(Number.NaN)).toBeNull();
    expect(moneyNumber("")).toBeNull();
    expect(egpValue(null)).toBe("—");
    expect(egpValue("1200")).toBe(egp(1200));
  });

  it("sums known money and preserves unknown-count metadata", () => {
    const summary = sumMoney([100, "250", null, Number.NaN]);
    expect(summary).toEqual({ total: 350, unknownCount: 2, hasUnknown: true });
    expect(egpSummary(summary)).toBe(`${egp(350)} + غير معروف`);
    expect(egpSummary(sumMoney([100, "250"]))).toBe(egp(350));
  });

  it("num honors the decimals argument (1dp ≠ 2dp; was a contract bug)", () => {
    const oneDp = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 1 }).format(12.857);
    expect(num(12.857, 1)).toBe(oneDp); // exactly one decimal, not two
    expect(num(12.857, 1)).not.toBe(num(12.857, 2)); // decimals actually distinguishes
    expect(num(12.857)).toBe(num(12.857, 0)); // default stays 0 dp
  });

  describe("coverageDays", () => {
    it("renders the infinite sentinel as ∞ (not NaN)", () => {
      // The RPC returns the STRING "∞" for zero demand — the bug was num("∞") => "ليس رقمًا".
      expect(coverageDays("∞")).toBe("∞");
      expect(coverageDays(null)).toBe("∞");
      expect(coverageDays(undefined)).toBe("∞");
    });
    it("formats a finite number to one decimal (matches num)", () => {
      expect(coverageDays(4.2)).toBe(num(4.2, 1));
      expect(coverageDays(0)).toBe(num(0, 1));
    });
    it("never returns the NaN string", () => {
      expect(coverageDays("∞")).not.toMatch(/ليس رقم/);
    });
  });
});
