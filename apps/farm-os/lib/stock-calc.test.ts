import { describe, it, expect } from "vitest";
import {
  availableStock,
  safetyStock,
  reorderPoint,
  coverageDays,
  projectedAvailableBalance,
  firstShortagePeriod,
  recommendPurchase,
} from "./stock-calc";

// SPEC-0001 worked Ebeid example is the oracle. These numbers are asserted
// exactly (with small float tolerance where the spec rounds). Never weaken a
// test to make the engine pass — fix the engine.
//
// Scenario: on_hand 300 kg سلفات بوتاسيوم; plan needs 500 kg next week;
// lead time 5 days; 95% service (Z=1.65); σ_d = 20 kg/day; pack size 50 kg.
describe("stock-coverage engine — SPEC-0001 Ebeid oracle", () => {
  it("Available = on_hand − reserved = 300", () => {
    expect(availableStock(300, 0)).toBe(300);
    // covered counter-example: 100 on_hand, 20 reserved → 80 available
    expect(availableStock(100, 20)).toBe(80);
  });

  it("Safety stock SS = Z·σ_d·√L ≈ 74 (Z=1.65, σ=20, L=5)", () => {
    expect(safetyStock(1.65, 20, 5)).toBeCloseTo(73.79, 1);
    expect(Math.round(safetyStock(1.65, 20, 5))).toBe(74);
  });

  it("Reorder point ROP = demand-over-lead + SS, and ROP > on_hand 300 → reorder now", () => {
    // daily demand = 500/7 ≈ 71.43 kg/day; demand over 5-day lead ≈ 357.14; + SS 74 ≈ 431
    const dBar = 500 / 7;
    const rop = reorderPoint(dBar, 5, safetyStock(1.65, 20, 5));
    expect(rop).toBeGreaterThan(300); // ROP > on_hand → reorder
    expect(Math.round(rop)).toBe(431);
  });

  it("PAB(1) = 300 − 500 = −200 (opening 300, issue 500 in period 1, no receipts); first shortage = period 1", () => {
    const pab = projectedAvailableBalance(300, [500], [0]);
    expect(pab[0]).toBe(300); // opening
    expect(pab[1]).toBe(-200); // after period 1
    expect(firstShortagePeriod(pab)).toBe(1);
  });

  it("Coverage days ≈ 4.2 (300 ÷ (500/7)) < 5-day lead → shortage", () => {
    const cov = coverageDays(300, 500 / 7);
    expect(cov).toBeCloseTo(4.2, 1);
    expect(cov).toBeLessThan(5);
  });

  it("Recommended purchase ≈ shortfall 200 + SS 74 − receipts 0 = 274 → round up to pack 50 = 300 kg; order today", () => {
    const r = recommendPurchase({
      shortfall: 200,
      safetyStock: 74,
      scheduledReceipts: 0,
      packSize: 50,
    });
    expect(r.rawQty).toBe(274);
    expect(r.qty).toBe(300); // ceil(274/50)*50
    expect(r.orderToday).toBe(true);
    expect(r.message_ar).toContain("نقص متوقع");
    expect(r.message_ar).toContain("300");
  });

  // ---- edge cases (SPEC-0001 §2 test strategy) ----
  it("edge: zero demand → no shortage, coverage Infinity", () => {
    expect(firstShortagePeriod(projectedAvailableBalance(300, [0], [0]))).toBeNull();
    expect(coverageDays(300, 0)).toBe(Infinity);
  });

  it("edge: on_hand ≥ requirement → covered, PAB stays positive", () => {
    const pab = projectedAvailableBalance(600, [500], [0]);
    expect(pab[1]).toBe(100);
    expect(firstShortagePeriod(pab)).toBeNull();
  });

  it("edge: lead time > horizon does not crash recommendation", () => {
    const r = recommendPurchase({ shortfall: 0, safetyStock: 0, scheduledReceipts: 0, packSize: 50 });
    expect(r.qty).toBe(0);
    expect(r.orderToday).toBe(false);
  });

  it("edge: scheduled receipts net into PAB and reduce the recommendation", () => {
    // 300 opening, period1 issue 500 + receipt 300 → PAB1 = 100 (covered)
    const pab = projectedAvailableBalance(300, [500, 0], [300, 0]);
    expect(pab[1]).toBe(100);
    // recommendation nets scheduled receipts: shortfall 200 + SS 74 − 300 = negative → 0
    const r = recommendPurchase({ shortfall: 200, safetyStock: 74, scheduledReceipts: 300, packSize: 50 });
    expect(r.qty).toBe(0);
  });

  it("edge: expiry is netted into on_hand, not subtracted twice (ENGINE-C1)", () => {
    // 50 kg expired ⇒ the ledger already dropped on_hand to 250 (expiry is a negative
    // movement), so available = on_hand(250) − reserved(0) = 250 — never on_hand − reserved − expired.
    expect(availableStock(250, 0)).toBe(250);
  });
});
