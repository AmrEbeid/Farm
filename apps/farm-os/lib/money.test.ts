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
  it("renders Arabic-Indic digits, never Western 0-9 (non-negotiable #1: no digit leaks)", () => {
    // These helpers are THE enforcement point for the no-Western-digit-leak rule. The other tests
    // assert self-consistency (egpValue === egp) but not the actual glyphs — a locale/formatter
    // regression could silently emit ASCII 0-9 and still pass. Assert the real Arabic-Indic numerals
    // (٠-٩, U+0660-0669) and the ABSENCE of any ASCII digit, across every formatter that emits one.
    const arabicDigit = /[٠-٩]/;
    const asciiDigit = /[0-9]/;
    for (const out of [
      num(1234567),
      num(3.5, 1),
      num(12.34, 2),
      egp(1500),
      egpValue("2400"),
      pct(42),
      coverageDays(4.2),
      egpSummary(sumMoney([100, "250"])),
    ]) {
      expect(out).toMatch(arabicDigit);
      expect(out).not.toMatch(asciiDigit);
    }
  });

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
    it("treats a non-finite NUMBER (NaN/Infinity) as ∞, not the NaN string", () => {
      // Guards the Number.isFinite-false branch for numeric input (a bad RPC value), distinct from the
      // string "∞" sentinel: e.g. a divide-by-zero coverage that arrives as a real NaN must not leak.
      expect(coverageDays(NaN)).toBe("∞");
      expect(coverageDays(Infinity)).toBe("∞");
      expect(coverageDays(-Infinity)).toBe("∞");
    });
  });
});
