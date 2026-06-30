import { describe, it, expect } from "vitest";
import { formatChartNumber } from "./formatChartNumber";

describe("formatChartNumber", () => {
  it("renders integers as Arabic-Indic digits", () => {
    expect(formatChartNumber(0)).toBe("٠");
    expect(formatChartNumber(7)).toBe("٧");
    expect(formatChartNumber(4380)).toBe("٤٬٣٨٠");
  });

  it("renders numeric strings as Arabic-Indic digits", () => {
    expect(formatChartNumber("120")).toBe("١٢٠");
  });

  it("contains no Western (Latin) digits for numeric input", () => {
    expect(formatChartNumber(123456)).not.toMatch(/[0-9]/);
  });

  it("passes non-numeric category strings through unchanged", () => {
    expect(formatChartNumber("يناير")).toBe("يناير");
  });

  it("handles non-finite and nullish input safely", () => {
    expect(formatChartNumber(NaN)).toBe("");
    expect(formatChartNumber(Infinity)).toBe("");
    expect(formatChartNumber(null)).toBe("");
    expect(formatChartNumber(undefined)).toBe("");
  });
});
