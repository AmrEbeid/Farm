import { describe, expect, it } from "vitest";
import {
  type BuyerSaleRow,
  isHistoricalSale,
  isSettledHistoricalSale,
  summariseBuyerSales,
} from "./buyer-sales";

const operational = (id: string, total: number, payment = "unpaid"): BuyerSaleRow => ({
  id,
  total,
  price_status: "finalized",
  payment_status: payment,
});
const historical = (id: string, total: number): BuyerSaleRow => ({
  id,
  total,
  price_status: "finalized",
  payment_status: "historical_treasury",
});
const reversed = (id: string, total: number): BuyerSaleRow => ({
  id,
  total,
  price_status: "finalized",
  payment_status: "historical_reversed",
});
const pending = (id: string): BuyerSaleRow => ({
  id,
  total: null,
  price_status: "pending",
  payment_status: "unpaid",
});

describe("summariseBuyerSales — operational behaviour is unchanged", () => {
  it("sums finalized totals and real collections, leaving the balance outstanding", () => {
    const s = summariseBuyerSales(
      [operational("a", 1000), operational("b", 500)],
      new Map([["a", 400]]),
    );
    expect(s.finalizedTotal).toBe(1500);
    expect(s.collectedTotal).toBe(400);
    expect(s.outstanding).toBe(1100);
  });

  it("excludes pending-price sales from the money, but still counts them", () => {
    const s = summariseBuyerSales([operational("a", 1000), pending("p")], new Map());
    expect(s.finalizedTotal).toBe(1000);
    expect(s.pendingCount).toBe(1);
    expect(s.sales).toHaveLength(2);
  });

  it("clamps a single over-collected sale's own contribution at zero", () => {
    const s = summariseBuyerSales([operational("a", 100)], new Map([["a", 250]]));
    expect(s.outstanding).toBe(0);
  });

  it("an over-collection on ONE sale must not mask a genuine debt on another", () => {
    // Netting the aggregates would give max(0, 200 - 250) = 0 and report the buyer as settled,
    // hiding B's real 100 debt. Outstanding is therefore computed per sale and summed.
    const s = summariseBuyerSales(
      [operational("a", 100), operational("b", 100)],
      new Map([["a", 250]]),
    );
    expect(s.outstanding).toBe(100);
    // The presentation aggregates still report what actually happened.
    expect(s.finalizedTotal).toBe(200);
    expect(s.collectedTotal).toBe(250);
  });
});

describe("summariseBuyerSales — historical reconciliation sales", () => {
  it("keeps a historical sale in the buyer's history and purchase total", () => {
    const s = summariseBuyerSales([historical("h", 25_000)], new Map());
    expect(s.sales).toHaveLength(1);
    expect(s.finalizedTotal).toBe(25_000);
  });

  it("counts a historical sale's own total as collected — it was settled in cash at posting", () => {
    const s = summariseBuyerSales([historical("h", 25_000)], new Map());
    expect(s.collectedTotal).toBe(25_000);
  });

  it("reports ZERO outstanding for a historical sale, so no collection CTA is offered", () => {
    const s = summariseBuyerSales([historical("h", 25_000)], new Map());
    // The page renders «سجّل تحصيلًا منه» only when outstanding > 0, and the DB guard would refuse
    // a collection against this sale — so a non-zero value here would be an unusable dead end.
    expect(s.outstanding).toBe(0);
  });

  it("does not invent a collection when the detail table happens to hold one anyway", () => {
    // Defence in depth: the DB guard makes this unreachable, but the arithmetic must not double-count.
    const s = summariseBuyerSales([historical("h", 25_000)], new Map([["h", 25_000]]));
    expect(s.collectedTotal).toBe(25_000);
    expect(s.outstanding).toBe(0);
  });

  it("an over-collected operational sale cannot mask a debt sitting behind a historical one", () => {
    const s = summariseBuyerSales(
      [historical("h", 25_000), operational("a", 100), operational("b", 100)],
      new Map([["a", 250]]),
    );
    expect(s.outstanding).toBe(100);
  });

  it("mixes historical settlement with a real operational debt correctly", () => {
    const s = summariseBuyerSales(
      [historical("h", 25_000), operational("a", 1000)],
      new Map([["a", 250]]),
    );
    expect(s.finalizedTotal).toBe(26_000);
    expect(s.collectedTotal).toBe(25_250);
    expect(s.outstanding).toBe(750); // only the genuine operational balance
  });

  it("drops a reversed sale from history, revenue, collections and the count", () => {
    const s = summariseBuyerSales([reversed("r", 9_999), operational("a", 100)], new Map());
    expect(s.sales.map((x) => x.id)).toEqual(["a"]);
    expect(s.finalizedTotal).toBe(100);
    expect(s.collectedTotal).toBe(0);
    expect(s.outstanding).toBe(100);
  });

  it("a buyer whose only sales are historical shows fully settled", () => {
    const s = summariseBuyerSales([historical("h1", 10), historical("h2", 20)], new Map());
    expect(s.finalizedTotal).toBe(30);
    expect(s.collectedTotal).toBe(30);
    expect(s.outstanding).toBe(0);
  });
});

describe("historical-state predicates", () => {
  it.each(["historical_treasury", "historical_reversed"])("recognises %s", (s) =>
    expect(isHistoricalSale(s)).toBe(true),
  );
  it.each(["unpaid", "partially_collected", "collected", null, undefined])(
    "does not treat %s as historical",
    (s) => expect(isHistoricalSale(s)).toBe(false),
  );
  it("only the treasury state is SETTLED — a reversed sale is not a settled one", () => {
    expect(isSettledHistoricalSale("historical_treasury")).toBe(true);
    expect(isSettledHistoricalSale("historical_reversed")).toBe(false);
    expect(isSettledHistoricalSale("collected")).toBe(false);
  });
});
