import { describe, it, expect } from "vitest";
import { computePayroll, type LaborEntry } from "./payroll";

describe("computePayroll — reconciliation oracle (SPEC-0006 §4.2)", () => {
  it("gross per person = Σ(hours × rate), reconciled to a hand-computed fixture", () => {
    const labor: LaborEntry[] = [
      { personId: "p1", hours: 8 },
      { personId: "p1", hours: 4 }, // 12h total
      { personId: "p2", hours: 6 },
    ];
    const rates = new Map([
      ["p1", 50], // 12 × 50 = 600
      ["p2", 40], // 6 × 40 = 240
    ]);
    const run = computePayroll(labor, rates);
    expect(run.lines).toEqual([
      { personId: "p1", hours: 12, rate: 50, gross: 600, rateMissing: false },
      { personId: "p2", hours: 6, rate: 40, gross: 240, rateMissing: false },
    ]);
    expect(run.total).toBe(840);
    expect(run.missingRates).toEqual([]);
  });

  it("FLAGS a missing rate (never fabricates a wage — non-negotiable #1)", () => {
    const run = computePayroll([{ personId: "p9", hours: 10 }], new Map());
    expect(run.lines[0]).toEqual({ personId: "p9", hours: 10, rate: null, gross: 0, rateMissing: true });
    expect(run.missingRates).toEqual(["p9"]);
    expect(run.total).toBe(0);
  });

  it("ignores garbage hours (negative / non-finite), never crashes", () => {
    const run = computePayroll(
      [
        { personId: "p1", hours: 8 },
        { personId: "p1", hours: -3 }, // ignored
        { personId: "p1", hours: Infinity }, // ignored
      ],
      new Map([["p1", 10]]),
    );
    expect(run.lines[0].hours).toBe(8);
    expect(run.total).toBe(80);
  });

  it("rejects a negative rate as missing (flagged, not paid)", () => {
    const run = computePayroll([{ personId: "p1", hours: 5 }], new Map([["p1", -20]]));
    expect(run.lines[0].rateMissing).toBe(true);
    expect(run.total).toBe(0);
  });

  it("FLAGS a zero rate — never silently pays logged hours nothing (non-negotiable #1)", () => {
    const run = computePayroll([{ personId: "p1", hours: 7 }], new Map([["p1", 0]]));
    expect(run.lines[0]).toEqual({ personId: "p1", hours: 7, rate: null, gross: 0, rateMissing: true });
    expect(run.missingRates).toEqual(["p1"]);
    expect(run.total).toBe(0);
  });

  it("reconciles fractional EGP rates across multiple lines (per-line rounding then sum)", () => {
    // Hand-computed: p1 8.5h @ 37.50 = 318.75; p2 6.25h @ 24.00 = 150.00; total 468.75
    const labor: LaborEntry[] = [
      { personId: "p1", hours: 8.5 },
      { personId: "p2", hours: 6.25 },
    ];
    const rates = new Map([
      ["p1", 37.5],
      ["p2", 24],
    ]);
    const run = computePayroll(labor, rates);
    expect(run.lines).toEqual([
      { personId: "p1", hours: 8.5, rate: 37.5, gross: 318.75, rateMissing: false },
      { personId: "p2", hours: 6.25, rate: 24, gross: 150, rateMissing: false },
    ]);
    expect(run.total).toBe(468.75);
    expect(run.missingRates).toEqual([]);
  });

  it("empty labor array → empty run (idempotency base case)", () => {
    expect(computePayroll([], new Map())).toEqual({ lines: [], total: 0, missingRates: [] });
  });

  it("rounds gross + total to 2 decimals", () => {
    const run = computePayroll([{ personId: "p1", hours: 1.5 }], new Map([["p1", 33.33]]));
    expect(run.lines[0].gross).toBe(50); // 1.5 × 33.33 = 49.995 → 50.00
  });

  it("is deterministic — stable line order regardless of input order (idempotency foundation)", () => {
    const a = computePayroll([{ personId: "p2", hours: 1 }, { personId: "p1", hours: 1 }], new Map([["p1", 1], ["p2", 1]]));
    const b = computePayroll([{ personId: "p1", hours: 1 }, { personId: "p2", hours: 1 }], new Map([["p2", 1], ["p1", 1]]));
    expect(a).toEqual(b);
    expect(a.lines.map((l) => l.personId)).toEqual(["p1", "p2"]);
  });
});
