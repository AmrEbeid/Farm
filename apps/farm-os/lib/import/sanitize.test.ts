import { describe, it, expect } from "vitest";
import { sanitizeCell } from "./sanitize";

describe("sanitizeCell", () => {
  it("returns empty string for null/undefined", () => {
    expect(sanitizeCell(null)).toBe("");
    expect(sanitizeCell(undefined)).toBe("");
  });

  it("leaves ordinary text and numbers unchanged (coerced to string)", () => {
    expect(sanitizeCell("مزارع عبيد")).toBe("مزارع عبيد");
    expect(sanitizeCell(42)).toBe("42");
    expect(sanitizeCell(3.5)).toBe("3.5");
  });

  it("prefixes a leading formula trigger with a single quote", () => {
    for (const c of ["=", "+", "-", "@"]) {
      expect(sanitizeCell(`${c}cmd|' /C calc'!A1`)).toBe(`'${c}cmd|' /C calc'!A1`);
    }
  });

  it("guards leading tab and carriage return then strips the control char", () => {
    expect(sanitizeCell("\t=1+1")).toBe("'=1+1");
    expect(sanitizeCell("\r=1+1")).toBe("'=1+1");
  });

  it("strips embedded control characters", () => {
    expect(sanitizeCell("ab\u0007cd")).toBe("abcd");
  });
});
