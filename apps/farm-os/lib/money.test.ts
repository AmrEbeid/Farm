import { describe, it, expect } from "vitest";
import { egp, num, pct, coverageDays } from "./money";

describe("money formatters", () => {
  it("egp/num/pct guard null and NaN with an em dash", () => {
    expect(egp(null)).toBe("—");
    expect(num(undefined)).toBe("—");
    expect(pct(NaN)).toBe("—");
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
