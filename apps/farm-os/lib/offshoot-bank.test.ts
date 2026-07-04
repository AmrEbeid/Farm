import { describe, expect, it } from "vitest";
import { buildOffshootBankSummary } from "./offshoot-bank";

const centers = [
  { id: "cc-1", code: "CC-HSW", name_ar: "الحصوة" },
  { id: "cc-2", code: "CC-BAB", name_ar: "حوض البابور" },
];

describe("buildOffshootBankSummary", () => {
  it("keeps the offshoot bank as a physical balance, not booked revenue", () => {
    const summary = buildOffshootBankSummary({
      costCenters: centers,
      movements: [
        { id: "m1", movement_date: "2026-07-01", movement_type: "produce", qty: 100, source_cost_center_id: "cc-1", dest_cost_center_id: null, note: null },
        { id: "m2", movement_date: "2026-07-02", movement_type: "plant", qty: 30, source_cost_center_id: null, dest_cost_center_id: "cc-2", note: null },
        { id: "m3", movement_date: "2026-07-03", movement_type: "replant", qty: 5, source_cost_center_id: null, dest_cost_center_id: "cc-2", note: null },
        { id: "m4", movement_date: "2026-07-04", movement_type: "sell", qty: 10, source_cost_center_id: null, dest_cost_center_id: null, note: null },
      ],
      valuation: { low_per_unit: 300, high_per_unit: 600 },
    });

    expect(summary.remaining).toBe(55);
    expect(summary.estimatedLow).toBe(16500);
    expect(summary.estimatedHigh).toBe(33000);
    expect(summary.destinationRows).toEqual([
      { id: "cc-2", center: "CC-BAB · حوض البابور", planted: 30, replanted: 5, total: 35 },
    ]);
  });

  it("flags negative physical balance without producing a negative valuation estimate", () => {
    const summary = buildOffshootBankSummary({
      costCenters: centers,
      movements: [
        { id: "m1", movement_date: "2026-07-01", movement_type: "produce", qty: 5, source_cost_center_id: null, dest_cost_center_id: null, note: null },
        { id: "m2", movement_date: "2026-07-02", movement_type: "sell", qty: 8, source_cost_center_id: null, dest_cost_center_id: null, note: null },
      ],
      valuation: { low_per_unit: 300, high_per_unit: 600 },
    });

    expect(summary.remaining).toBe(-3);
    expect(summary.hasNegativeBalance).toBe(true);
    expect(summary.estimatedLow).toBe(0);
    expect(summary.estimatedHigh).toBe(0);
  });
});
