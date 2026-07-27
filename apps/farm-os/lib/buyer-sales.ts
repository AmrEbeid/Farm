import { HISTORICAL_SALE_PAYMENT_STATUSES } from "./labels";

/**
 * Buyer-360 sale accounting.
 *
 * A reconciliation-created historical sale (migration 20260726160000) is a real, finalized sale for
 * the buyer — it belongs in his history, his sale count and his purchase total — but it was SETTLED
 * IN CASH at posting (Dr 1010 النقدية بالخزينة). It therefore has no `sale_collections` detail row
 * and by contract never can: the DB guard refuses a collection against it. Summing the detail table
 * alone would report the buyer as still owing the full amount and would offer a «سجّل تحصيلًا منه»
 * call-to-action that the database is guaranteed to reject.
 *
 * A `historical_reversed` sale is a different case: its revenue journal has been reversed, so it is
 * not revenue at all and is excluded from the history entirely (the page's query drops it at the
 * source; `summariseBuyerSales` drops it again so the arithmetic is correct on any input).
 *
 * Extracted as a pure function so the arithmetic is testable without a database.
 */
export type BuyerSaleRow = {
  id: string;
  total: number | null;
  price_status: string | null;
  payment_status: string | null;
};

/** Generic in the row type so callers keep their own display fields (crop, qty, dates, …). */
export type BuyerSalesSummary<T extends BuyerSaleRow = BuyerSaleRow> = {
  /** Sales that count toward this buyer's history (reversed rows removed). */
  sales: T[];
  /** Σ total over finalized sales, including historical ones. */
  finalizedTotal: number;
  /**
   * Σ real collections + Σ total of historical sales (settled at posting). Presentation figure:
   * it reports what was actually received, so an over-collection on one sale IS visible here.
   */
  collectedTotal: number;
  /**
   * Σ over each finalized sale of max(0, its total − its own collections). Computed PER SALE, not
   * from the two aggregates above: netting the aggregates would let an over-collection on one sale
   * silently cancel a genuine debt on another. Never negative; a historical sale contributes zero.
   */
  outstanding: number;
  pendingCount: number;
};

export function isHistoricalSale(paymentStatus: string | null | undefined): boolean {
  return (HISTORICAL_SALE_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus ?? "");
}

/** True only for a sale that is settled and can never accept a collection. */
export function isSettledHistoricalSale(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "historical_treasury";
}

export function summariseBuyerSales<T extends BuyerSaleRow>(
  sales: readonly T[],
  collectionsBySaleId: ReadonlyMap<string, number>,
): BuyerSalesSummary<T> {
  const visible = sales.filter((s) => s.payment_status !== "historical_reversed");
  const finalized = visible.filter((s) => s.price_status === "finalized");

  const finalizedTotal = finalized.reduce((t, s) => t + Number(s.total ?? 0), 0);

  const collectedTotal = finalized.reduce((t, s) => {
    // A historical sale's own total IS its collection; it has no detail row to sum.
    if (isSettledHistoricalSale(s.payment_status)) return t + Number(s.total ?? 0);
    return t + (collectionsBySaleId.get(s.id) ?? 0);
  }, 0);

  // Per-sale, then summed. `max(0, Σtotal − Σcollected)` would be wrong: over-collecting 150 on one
  // sale would cancel a real 100 debt on another and report the buyer as settled.
  const outstanding = finalized.reduce((t, s) => {
    if (isSettledHistoricalSale(s.payment_status)) return t; // settled in cash at posting
    return t + Math.max(0, Number(s.total ?? 0) - (collectionsBySaleId.get(s.id) ?? 0));
  }, 0);

  return {
    sales: visible,
    finalizedTotal,
    collectedTotal,
    outstanding,
    pendingCount: visible.length - finalized.length,
  };
}
