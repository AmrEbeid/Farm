import { describe, expect, it } from "vitest";
import { computeExportReadiness, type ReadinessInput } from "./export-readiness";

// A fully-eligible baseline (China / Barhi dates), then each test breaks one condition.
function base(): ReadinessInput {
  return {
    market: "CN",
    crop: "dates",
    variety: "Barhi",
    onDate: "2025-11-01",
    registrations: [{ market: "CN", status: "Normal", valid_from: "2025-10-24", valid_to: "2999-12-31" }],
    accreditations: [
      { destination_market: "CN", crop: "dates", variety: "Barhi", valid_from: "2025-08-01", valid_to: "2025-12-31" },
    ],
    residueResults: [{ compound: "Hexythiazox", value_mg_kg: 0.01 }],
    mrlByCompound: { Hexythiazox: 0.1 }, // authoritative destination limit (supplied, not fabricated)
    phiRespected: true,
  };
}

describe("computeExportReadiness", () => {
  it("is eligible when every condition holds", () => {
    const r = computeExportReadiness(base());
    expect(r.eligible).toBe(true);
    expect(r.reasons.every((x) => x.ok)).toBe(true);
  });

  it("is ineligible when the GACC registration is expired", () => {
    const i = base();
    i.registrations = [{ market: "CN", status: "Normal", valid_from: "2024-01-01", valid_to: "2024-12-31" }];
    const r = computeExportReadiness(i);
    expect(r.eligible).toBe(false);
    expect(r.reasons.find((x) => x.code === "registration")?.ok).toBe(false);
  });

  it("is ineligible when no accreditation covers the variety", () => {
    const i = base();
    i.accreditations[0].variety = "Medjool";
    const r = computeExportReadiness(i);
    expect(r.eligible).toBe(false);
    expect(r.reasons.find((x) => x.code === "accreditation")?.ok).toBe(false);
  });

  it("is ineligible when a residue exceeds the market MRL", () => {
    const i = base();
    i.residueResults = [{ compound: "Hexythiazox", value_mg_kg: 0.5 }]; // > 0.1
    const r = computeExportReadiness(i);
    expect(r.eligible).toBe(false);
    expect(r.reasons.find((x) => x.code === "residue")?.ok).toBe(false);
  });

  it("fails closed when a residue compound has no known MRL", () => {
    const i = base();
    i.mrlByCompound = {}; // unknown limit → cannot certify
    const r = computeExportReadiness(i);
    expect(r.eligible).toBe(false);
    expect(r.reasons.find((x) => x.code === "residue")?.ok).toBe(false);
  });

  it("fails closed when a residue value is negative", () => {
    const i = base();
    i.residueResults = [{ compound: "Hexythiazox", value_mg_kg: -0.01 }];
    const r = computeExportReadiness(i);
    expect(r.eligible).toBe(false);
    expect(r.reasons.find((x) => x.code === "residue")?.ok).toBe(false);
  });

  it("fails closed when there is no residue test on file", () => {
    const i = base();
    i.residueResults = [];
    const r = computeExportReadiness(i);
    expect(r.eligible).toBe(false);
    expect(r.reasons.find((x) => x.code === "residue")?.ok).toBe(false);
  });

  it("is ineligible when PHI was not respected", () => {
    const i = base();
    i.phiRespected = false;
    const r = computeExportReadiness(i);
    expect(r.eligible).toBe(false);
    expect(r.reasons.find((x) => x.code === "phi")?.ok).toBe(false);
  });
});
