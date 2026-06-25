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

// Edge cases beyond the SPEC-0001 Ebeid oracle (stock-calc.test.ts). These probe
// boundaries the worked example doesn't reach: zero/negative/large inputs, pack
// rounding, horizon boundaries, the no-plan case, and multi-receipt netting.

describe("availableStock — edges", () => {
  it("can go negative when reserved exceeds on_hand", () => {
    expect(availableStock(100, 130)).toBe(-30);
  });
  it("returns on_hand when nothing is reserved", () => {
    expect(availableStock(500, 0)).toBe(500);
  });
});

describe("safetyStock — edges", () => {
  it("is zero when lead time is zero (√0)", () => {
    expect(safetyStock(1.65, 20, 0)).toBe(0);
  });
  it("is zero when sigma is zero (no demand variability)", () => {
    expect(safetyStock(1.65, 0, 5)).toBe(0);
  });
  it("scales with the service-level Z factor", () => {
    const lo = safetyStock(1.28, 20, 5);
    const hi = safetyStock(2.33, 20, 5);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("reorderPoint — edges", () => {
  it("equals SS alone when lead time is zero", () => {
    expect(reorderPoint(71.43, 0, 74)).toBe(74);
  });
  it("equals demand-over-lead alone when SS is zero", () => {
    expect(reorderPoint(10, 5, 0)).toBe(50);
  });
});

describe("coverageDays — boundaries", () => {
  it("is Infinity for zero demand", () => {
    expect(coverageDays(300, 0)).toBe(Infinity);
  });
  it("is Infinity for negative demand (treated as no draw-down)", () => {
    expect(coverageDays(300, -5)).toBe(Infinity);
  });
  it("is zero when there is no available stock but positive demand", () => {
    expect(coverageDays(0, 10)).toBe(0);
  });
  it("divides available by daily demand for the finite case", () => {
    expect(coverageDays(300, 100)).toBe(3);
  });
});

describe("projectedAvailableBalance — edges", () => {
  it("with no plan (empty issues) returns just the opening balance", () => {
    expect(projectedAvailableBalance(300, [])).toEqual([300]);
  });

  it("treats missing receipts as zero (default arg) across multiple periods", () => {
    // opening 300; issue 100 each period, no receipts → 300,200,100,0,-100
    expect(projectedAvailableBalance(300, [100, 100, 100, 100])).toEqual([
      300, 200, 100, 0, -100,
    ]);
  });

  it("pads a shorter receipts array with zero (nullish coalescing on index)", () => {
    // receipts only for period 1; periods 2..3 default to 0
    expect(projectedAvailableBalance(100, [50, 50, 50], [200])).toEqual([
      100, 250, 200, 150,
    ]);
  });

  it("nets multiple scheduled receipts in the right periods", () => {
    // opening 0; issue 100/period; receipts 100,0,200
    //  t1: 0-100+100=0; t2: 0-100+0=-100; t3: -100-100+200=0
    expect(projectedAvailableBalance(0, [100, 100, 100], [100, 0, 200])).toEqual([
      0, 0, -100, 0,
    ]);
  });

  it("returns length issues.length + 1", () => {
    expect(projectedAvailableBalance(10, [1, 2, 3]).length).toBe(4);
  });
});

describe("firstShortagePeriod — edges", () => {
  it("returns null for an opening-only series (no plan)", () => {
    expect(firstShortagePeriod([300])).toBeNull();
  });

  it("ignores the opening balance even if it is below threshold", () => {
    // index 0 (opening) is -5 but never gets scanned; periods stay >= 0
    expect(firstShortagePeriod([-5, 10, 20])).toBeNull();
  });

  it("reports the FIRST breaching period, not a later one", () => {
    expect(firstShortagePeriod([300, 200, -10, -50])).toBe(2);
  });

  it("a balance exactly at the default threshold (0) is NOT a shortage", () => {
    expect(firstShortagePeriod([300, 0, 0])).toBeNull();
  });

  it("supports a custom threshold for the 'below safety stock' warning", () => {
    // below-SS warning at threshold 50: first period under 50 is period 2 (40)
    expect(firstShortagePeriod([300, 60, 40, 30], 50)).toBe(2);
  });
});

describe("recommendPurchase — edges", () => {
  it("zero shortfall and zero SS → nothing to order", () => {
    const r = recommendPurchase({ shortfall: 0, safetyStock: 0, scheduledReceipts: 0, packSize: 50 });
    expect(r.rawQty).toBe(0);
    expect(r.qty).toBe(0);
    expect(r.orderToday).toBe(false);
    expect(r.message_ar).toContain("كافٍ");
  });

  it("floors raw qty at 0 when receipts exceed need (never recommends negative)", () => {
    const r = recommendPurchase({ shortfall: 100, safetyStock: 50, scheduledReceipts: 500, packSize: 50 });
    expect(r.rawQty).toBe(0);
    expect(r.qty).toBe(0);
    expect(r.orderToday).toBe(false);
  });

  it("rounds UP to the pack size", () => {
    // need 274, pack 50 → ceil(274/50)*50 = 300
    const r = recommendPurchase({ shortfall: 200, safetyStock: 74, scheduledReceipts: 0, packSize: 50 });
    expect(r.rawQty).toBe(274);
    expect(r.qty).toBe(300);
    expect(r.orderToday).toBe(true);
  });

  it("does not over-round when need is an exact pack multiple", () => {
    const r = recommendPurchase({ shortfall: 100, safetyStock: 0, scheduledReceipts: 0, packSize: 50 });
    expect(r.qty).toBe(100); // ceil(100/50)*50 = 100, no extra pack
  });

  it("falls back to pack size 1 when pack size is zero", () => {
    const r = recommendPurchase({ shortfall: 7, safetyStock: 0, scheduledReceipts: 0, packSize: 0 });
    expect(r.qty).toBe(7); // ceil(7/1)*1
    expect(r.orderToday).toBe(true);
  });

  it("falls back to pack size 1 when pack size is negative", () => {
    const r = recommendPurchase({ shortfall: 3, safetyStock: 0, scheduledReceipts: 0, packSize: -50 });
    expect(r.qty).toBe(3);
  });

  it("embeds the order quantity and shortfall in the Arabic message", () => {
    const r = recommendPurchase({ shortfall: 200, safetyStock: 74, scheduledReceipts: 0, packSize: 50 });
    expect(r.message_ar).toContain("نقص متوقع");
    expect(r.message_ar).toContain("200"); // shortfall
    expect(r.message_ar).toContain("300"); // ordered qty
  });

  it("handles large values without overflow surprises", () => {
    const r = recommendPurchase({ shortfall: 1_000_000, safetyStock: 0, scheduledReceipts: 0, packSize: 25 });
    expect(r.qty).toBe(1_000_000); // already a multiple of 25
    expect(r.orderToday).toBe(true);
  });
});
