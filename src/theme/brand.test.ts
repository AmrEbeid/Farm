import { it, expect, describe } from "vitest";
import { brandVars } from "./brand";
describe("brandVars", () => {
  it("maps a hex to brand role vars", () => {
    const v = brandVars("#2f7d49");
    expect(v["--brand"]).toBe("#2f7d49");
    expect(v["--brand-hover"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(v["--brand-contrast"]).toBe("#ffffff"); // dark brand → white text
  });
  it("picks dark contrast for a light brand", () => {
    expect(brandVars("#e8f0a0")["--brand-contrast"]).toBe("#0c1f12");
  });
  it("throws on a non-hex input", () => {
    expect(() => brandVars("blue")).toThrow();
  });
});
