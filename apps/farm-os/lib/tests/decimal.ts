import { describe, expect, it } from "vitest";
import {
  egpDecimalSummary,
  egpExact,
  formatDecimalArabic,
  isDecimalString,
  parseDecimal,
  roundDecimal,
  sumDecimals,
} from "../decimal";

describe("decimal — strict parsing of recorded amounts", () => {
  it("reads a PostgreSQL numeric string digit by digit, canonicalised", () => {
    expect(parseDecimal("125.50")).toBe("125.5");
    expect(parseDecimal("0007.500")).toBe("7.5");
    expect(parseDecimal("12")).toBe("12");
    expect(parseDecimal("12.")).toBe("12");
    expect(parseDecimal(" 42.25 ")).toBe("42.25");
    expect(parseDecimal("-0.00")).toBe("0"); // a signed zero is just zero
    expect(parseDecimal("-125.50")).toBe("-125.5");
    expect(parseDecimal("+125.50")).toBe("125.5");
  });

  it("keeps every significant digit of a value no double could hold", () => {
    // Only the value-preserving trailing zero is dropped: the canonical form depends on the VALUE,
    // not on the scale the driver happened to send, so "125.50" and 125.5 hash and export alike.
    expect(parseDecimal("12345678901234567890.12345678901234567890")).toBe(
      "12345678901234567890.1234567890123456789",
    );
    expect(parseDecimal("0.00000000000000000001")).toBe("0.00000000000000000001");
  });

  it("accepts a JSON number (what PostgREST may send) without further loss", () => {
    expect(parseDecimal(125.5)).toBe("125.5");
    expect(parseDecimal(0)).toBe("0");
    expect(parseDecimal(1e21)).toBe("1000000000000000000000");
    expect(parseDecimal(1.5e-7)).toBe("0.00000015");
    expect(parseDecimal(BigInt("900719925474099100"))).toBe("900719925474099100");
  });

  it("reports anything that is not a decimal as unknown — never as zero", () => {
    for (const value of [null, undefined, "", "   ", "abc", "1.2.3", "12,5", "١٢", "1e", NaN, Infinity, {}, []]) {
      expect(parseDecimal(value)).toBeNull();
    }
  });

  it("refuses an absurdly long value instead of pretending to read it", () => {
    expect(parseDecimal(`0.${"1".repeat(101)}`)).toBeNull();
    expect(parseDecimal("1".repeat(1001))).toBeNull();
  });

  it("recognises its own canonical output", () => {
    expect(isDecimalString("125.5")).toBe(true);
    expect(isDecimalString("125.50")).toBe(false);
    expect(isDecimalString(125.5)).toBe(false);
  });
});

describe("decimal — exact summing", () => {
  it("adds amounts a float would get wrong", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the reason this module exists
    expect(sumDecimals(["0.1", "0.2"]).total).toBe("0.3");
    expect(sumDecimals([0.1, 0.2]).total).toBe("0.3");
    expect(sumDecimals(["1.005", "2.005"]).total).toBe("3.01");
  });

  it("stays exact across a whole batch of piastre amounts", () => {
    const rows = Array.from({ length: 1000 }, () => "0.07");
    expect(sumDecimals(rows).total).toBe("70");
    expect(sumDecimals(rows).knownCount).toBe(1000);
  });

  it("mixes scales and signs without drift", () => {
    expect(sumDecimals(["1", "0.5", "0.25", "0.125"]).total).toBe("1.875");
    expect(sumDecimals(["100.50", "-100.50"]).total).toBe("0");
    expect(sumDecimals(["-1.10", "-2.20"]).total).toBe("-3.3");
  });

  it("counts unreadable values instead of adding them as zero", () => {
    const summary = sumDecimals(["10.25", null, "", "abc", 5]);
    expect(summary.total).toBe("15.25");
    expect(summary.knownCount).toBe(2);
    expect(summary.unknownCount).toBe(3);
    expect(summary.hasUnknown).toBe(true);
  });

  it("reports an empty input as a zero total with nothing counted", () => {
    expect(sumDecimals([])).toEqual({
      total: "0",
      knownCount: 0,
      unknownCount: 0,
      hasUnknown: false,
    });
  });
});

describe("decimal — rounding and rendering", () => {
  it("rounds half away from zero, in integer space", () => {
    expect(roundDecimal("1.005", 2)).toBe("1.01");
    expect(roundDecimal("1.004", 2)).toBe("1");
    expect(roundDecimal("2.675", 2)).toBe("2.68"); // the classic float failure (2.67 as a double)
    expect(roundDecimal("-1.005", 2)).toBe("-1.01");
    expect(roundDecimal("1.5", 0)).toBe("2");
    expect(roundDecimal("12.5", 4)).toBe("12.5");
  });

  it("rejects invalid output scales instead of producing malformed decimals", () => {
    expect(() => roundDecimal("1.23", -1)).toThrow(RangeError);
    expect(() => roundDecimal("1.23", 1.5)).toThrow(RangeError);
    expect(() => roundDecimal("1.23", 101)).toThrow(RangeError);
  });

  it("renders EGP with exactly two decimals in Arabic-Indic digits", () => {
    expect(egpExact("1234.5")).toBe("١٬٢٣٤٫٥٠ ج.م");
    expect(egpExact("0")).toBe("٠٫٠٠ ج.م");
    expect(egpExact("0.05")).toBe("٠٫٠٥ ج.م");
    expect(egpExact("125.499")).toBe("١٢٥٫٥٠ ج.م");
    expect(egpExact(null)).toBe("—");
    expect(egpExact("1234.5")).not.toMatch(/[0-9]/); // no Western-digit leak
  });

  it("renders a value far beyond double precision without dropping digits", () => {
    const rendered = formatDecimalArabic("12345678901234567890.129", 2);
    expect(rendered).toBe("١٢٬٣٤٥٬٦٧٨٬٩٠١٬٢٣٤٬٥٦٧٬٨٩٠٫١٣");
  });

  it("keeps a negative amount signed", () => {
    expect(formatDecimalArabic("-0.45", 2)).toContain("٠٫٤٥");
    expect(formatDecimalArabic("-0.45", 2)).not.toBe("٠٫٤٥");
  });

  it("says «+ غير معروف» only when something really was unreadable", () => {
    expect(egpDecimalSummary(sumDecimals(["10", "5.5"]))).toBe("١٥٫٥٠ ج.م");
    expect(egpDecimalSummary(sumDecimals(["10", null]))).toBe("١٠٫٠٠ ج.م + غير معروف");
  });
});
