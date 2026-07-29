import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";
import { isUuid as isUuidFromReconciliation } from "./reconciliation review";

/**
 * `lib/uuid.ts` exists so the attendance and compensation FORMS (client components) can validate an
 * id without dragging ~850 lines of server-side reconciliation logic across the client boundary. The
 * only risk that introduces is drift: two predicates that disagree would let a value pass one gate
 * and fail the other. This pins them against each other on the cases that matter.
 */

const SAMPLES = [
  "3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b",
  "3F2A1C5E-9B7D-4E21-8A64-0C1D2E3F4A5B",
  "  3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b  ",
  "00000000-0000-0000-0000-000000000000",
  "3f2a1c5e9b7d4e218a640c1d2e3f4a5b",
  "3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5",
  "3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5bb",
  "not-a-uuid",
  "",
  "   ",
  "'; drop table people; --",
];

describe("isUuid", () => {
  it("accepts a canonical 8-4-4-4-12 uuid in either case, with surrounding whitespace", () => {
    expect(isUuid("3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b")).toBe(true);
    expect(isUuid("3F2A1C5E-9B7D-4E21-8A64-0C1D2E3F4A5B")).toBe(true);
    expect(isUuid(" 3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b ")).toBe(true);
  });

  it("rejects the wrong shape, the wrong length, and non-strings", () => {
    expect(isUuid("3f2a1c5e9b7d4e218a640c1d2e3f4a5b")).toBe(false);
    expect(isUuid("3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid({})).toBe(false);
    expect(isUuid(["3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b"])).toBe(false);
  });

  it("agrees with the reconciliation module's own isUuid — the two must never drift", () => {
    for (const sample of SAMPLES) {
      expect(isUuid(sample), sample).toBe(isUuidFromReconciliation(sample));
    }
  });
});
