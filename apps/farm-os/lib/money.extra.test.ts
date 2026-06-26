import { describe, it, expect } from "vitest";
import { egp, num, pct, coverageDays } from "./money";

// These cover the guard branches and value handling of the formatters beyond the
// existing money.test.ts oracle. Assertions are anchored to the module's own
// Intl formatters (re-created here) rather than hardcoded Arabic-Indic glyphs, so
// they stay deterministic across ICU/Node versions while still proving behavior.
const FMT0 = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });
const FMT1 = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 1 });
const FMT2 = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });

const NULLISH: Array<number | null | undefined> = [null, undefined, NaN];

describe("egp", () => {
  it.each(NULLISH)("guards %s with an em dash", (v) => {
    expect(egp(v)).toBe("—");
  });

  it("formats zero (not a dash) and appends the EGP suffix", () => {
    expect(egp(0)).toBe(`${FMT0.format(0)} ج.م`);
    expect(egp(0)).not.toBe("—");
  });

  it("formats negative values", () => {
    expect(egp(-250)).toBe(`${FMT0.format(-250)} ج.م`);
  });

  it("formats large values with grouping and drops the fractional part", () => {
    expect(egp(1_000_000)).toBe(`${FMT0.format(1_000_000)} ج.م`);
    // maximumFractionDigits: 0 → rounds to whole units
    expect(egp(1234.56)).toBe(`${FMT0.format(1234.56)} ج.م`);
  });
});

describe("num", () => {
  it.each(NULLISH)("guards %s with an em dash", (v) => {
    expect(num(v)).toBe("—");
  });

  it("formats zero with default 0 decimals", () => {
    expect(num(0)).toBe(FMT0.format(0));
  });

  it("honors the decimals argument (1 dp ≠ 2 dp)", () => {
    expect(num(4.25)).toBe(FMT0.format(4.25)); // default 0 → rounded whole
    expect(num(4.25, 1)).toBe(FMT1.format(4.25)); // decimals=1 → 1 dp (fixed in #208)
    expect(num(4.25, 2)).toBe(FMT2.format(4.25)); // decimals=2 → 2 dp
  });

  it("formats negative and large values", () => {
    expect(num(-42)).toBe(FMT0.format(-42));
    expect(num(1_500_000)).toBe(FMT0.format(1_500_000));
  });
});

describe("pct", () => {
  it.each(NULLISH)("guards %s with an em dash", (v) => {
    expect(pct(v)).toBe("—");
  });

  it("formats zero and appends the percent sign", () => {
    expect(pct(0)).toBe(`${FMT0.format(0)}٪`);
  });

  it("formats negative and large values", () => {
    expect(pct(-5)).toBe(`${FMT0.format(-5)}٪`);
    expect(pct(95)).toBe(`${FMT0.format(95)}٪`);
    expect(pct(1000)).toBe(`${FMT0.format(1000)}٪`);
  });
});

describe("coverageDays — value handling", () => {
  it("renders the ∞ string sentinel and nullish as ∞", () => {
    expect(coverageDays("∞")).toBe("∞");
    expect(coverageDays(null)).toBe("∞");
    expect(coverageDays(undefined)).toBe("∞");
  });

  it("renders the numeric Infinity (non-finite) as ∞", () => {
    expect(coverageDays(Infinity)).toBe("∞");
    expect(coverageDays(-Infinity)).toBe("∞");
  });

  it("renders NaN as ∞ (non-finite branch), never the NaN string", () => {
    expect(coverageDays(NaN)).toBe("∞");
    expect(coverageDays(NaN)).not.toMatch(/ليس رقم/);
  });

  it("formats finite values to one decimal via num", () => {
    expect(coverageDays(0)).toBe(num(0, 1));
    expect(coverageDays(4.2)).toBe(num(4.2, 1));
    expect(coverageDays(-3.5)).toBe(num(-3.5, 1));
    expect(coverageDays(123.456)).toBe(num(123.456, 1));
  });
});
