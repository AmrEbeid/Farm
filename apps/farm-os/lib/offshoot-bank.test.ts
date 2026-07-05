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

  it("returns null estimates (not zero) when no valuation is configured — never fabricates a value", () => {
    const base = {
      costCenters: centers,
      movements: [
        { id: "m1", movement_date: "2026-07-01", movement_type: "produce" as const, qty: 40, source_cost_center_id: null, dest_cost_center_id: null, note: null },
      ],
    };
    const noValuation = buildOffshootBankSummary({ ...base, valuation: null });
    expect(noValuation.estimatedLow).toBeNull();
    expect(noValuation.estimatedHigh).toBeNull();
    // Undefined valuation behaves the same as an explicit null (no config → no estimate).
    expect(buildOffshootBankSummary(base).estimatedHigh).toBeNull();
  });

  it("coerces string / null / non-finite quantities to a numeric balance (asNumber)", () => {
    const summary = buildOffshootBankSummary({
      costCenters: centers,
      movements: [
        { id: "m1", movement_date: "2026-07-01", movement_type: "produce", qty: "90", source_cost_center_id: null, dest_cost_center_id: null, note: null },
        { id: "m2", movement_date: "2026-07-02", movement_type: "sell", qty: null as unknown as number, source_cost_center_id: null, dest_cost_center_id: null, note: null },
        { id: "m3", movement_date: "2026-07-03", movement_type: "plant", qty: "not-a-number", source_cost_center_id: null, dest_cost_center_id: "cc-2", note: null },
      ],
      valuation: null,
    });
    expect(summary.produced).toBe(90);
    expect(summary.sold).toBe(0);
    expect(summary.planted).toBe(0);
    expect(summary.remaining).toBe(90);
  });

  it("ranks destination cost centers by total planted+replanted, descending", () => {
    const summary = buildOffshootBankSummary({
      costCenters: centers,
      movements: [
        { id: "m1", movement_date: "2026-07-01", movement_type: "plant", qty: 10, source_cost_center_id: null, dest_cost_center_id: "cc-1", note: null },
        { id: "m2", movement_date: "2026-07-02", movement_type: "plant", qty: 25, source_cost_center_id: null, dest_cost_center_id: "cc-2", note: null },
        { id: "m3", movement_date: "2026-07-03", movement_type: "replant", qty: 4, source_cost_center_id: null, dest_cost_center_id: "cc-1", note: null },
      ],
      valuation: null,
    });
    expect(summary.destinationRows.map((r) => r.id)).toEqual(["cc-2", "cc-1"]);
    expect(summary.destinationRows[1]).toMatchObject({ id: "cc-1", planted: 10, replanted: 4, total: 14 });
  });
});
