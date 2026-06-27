import { describe, it, expect } from "vitest";
import { AR_ERROR_CODES } from "./errors";
import { WHY_BY_CODE, whyFor } from "./why";

describe("rule-based Why coverage (SPEC-0014 A3)", () => {
  it("covers every error code that lib/errors.ts maps (drift guard)", () => {
    for (const code of AR_ERROR_CODES) {
      const entry = WHY_BY_CODE[code];
      expect(entry, `missing Why entry for ${code}`).toBeDefined();
      expect(entry.explanation.trim().length).toBeGreaterThan(0);
      expect(entry.next.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not invent codes that errors.ts does not map", () => {
    for (const code of Object.keys(WHY_BY_CODE)) {
      expect(AR_ERROR_CODES, `Why entry ${code} has no errors.ts mapping`).toContain(code);
    }
  });

  it("whyFor returns the entry for a known code and null otherwise", () => {
    expect(whyFor("42501")?.explanation.length).toBeGreaterThan(0);
    expect(whyFor("00000")).toBeNull();
    expect(whyFor(null)).toBeNull();
    expect(whyFor(undefined)).toBeNull();
  });
});
