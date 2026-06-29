/**
 * Stock-coverage pure-calc core (SPEC-0001 — Stock-Coverage Intelligence Engine).
 *
 * Pure functions only — no DB, no IO — so the math is unit-testable in isolation.
 * These are a REFERENCE oracle mirroring the live `fn_stock_coverage` PL/pgSQL —
 * every UI surface reads the RPC, never these functions. There is no automatic
 * cross-language harness binding the two, so the formulas here must be kept aligned
 * with the SQL by hand and by the unit tests below (L5/#161).
 *
 * Conventions (stated per SPEC-0001 §2 and the build brief):
 *  - Available = on_hand − reserved. Expiry is NOT subtracted separately: an expiry is a
 *    negative stock movement in the ledger, so it is already netted into on_hand (matches
 *    `fn_stock_coverage` / ENGINE-C1, migration 0010 — L5/#161 keeps the TS core in parity).
 *  - Safety stock SS = Z·σ_d·√L  (Z: 1.28/1.65/2.33). Fixed-days fallback elsewhere.
 *  - Reorder point ROP = d̄·L + SS, where d̄ is the *daily* demand rate.
 *  - Daily demand = weekly requirement / 7 (the plan states weekly need; we spread
 *    it evenly across 7 days). This is the documented convention.
 *  - PAB recurrence: PAB(t) = PAB(t−1) − issues(t) + receipts(t); PAB[0] is opening.
 *  - Coverage days = available ÷ daily-demand (Infinity when demand ≤ 0).
 *  - Recommended purchase = max(0, maxDeficit + SS), rounded UP to the pack/MOQ.
 *    Sized off the DEEPEST projected deficit across the horizon (not the first dip),
 *    and scheduled receipts are NOT subtracted here — they are already netted into the
 *    PAB recurrence upstream, so subtracting them again would double-count. Matches the
 *    live SQL `v_raw := greatest(0, v_maxdef + v_ss)` (migrations 0040/0055/0078, #280 F4
 *    / ENGINE-REC1; L5/#161 closes the prior first-dip + receipts-subtraction drift).
 */

/** Available = on_hand − reserved. (Expiry is already netted into on_hand via the ledger —
 *  ENGINE-C1, migration 0010 — so it is never subtracted again here.) */
export function availableStock(onHand: number, reserved: number): number {
  return onHand - reserved;
}

/** Safety stock SS = Z·σ_d·√L (statistical). */
export function safetyStock(z: number, sigmaD: number, leadDays: number): number {
  return z * sigmaD * Math.sqrt(leadDays);
}

/** Reorder point ROP = d̄·L + SS, with d̄ the daily demand rate. */
export function reorderPoint(dailyDemand: number, leadDays: number, ss: number): number {
  return dailyDemand * leadDays + ss;
}

/** Coverage days = available ÷ daily demand; Infinity when demand ≤ 0. */
export function coverageDays(available: number, dailyDemand: number): number {
  return dailyDemand <= 0 ? Infinity : available / dailyDemand;
}

/**
 * Time-phased Projected Available Balance.
 * Returns an array of length issues.length + 1: index 0 is opening,
 * index t is the balance at the end of period t.
 */
export function projectedAvailableBalance(
  opening: number,
  issues: number[],
  receipts: number[] = [],
): number[] {
  const series = [opening];
  for (let t = 0; t < issues.length; t++) {
    const prev = series[t];
    const issue = issues[t] ?? 0;
    const receipt = receipts[t] ?? 0;
    series.push(prev - issue + receipt);
  }
  return series;
}

/**
 * First period (1-based, matching the PAB index) where the balance drops below
 * `threshold`. Returns null when the balance never breaches the threshold.
 * Pass threshold = safetyStock for the earlier "below safety stock" warning.
 */
export function firstShortagePeriod(series: number[], threshold = 0): number | null {
  for (let t = 1; t < series.length; t++) {
    if (series[t] < threshold) return t;
  }
  return null;
}

export interface PurchaseRecommendationInput {
  /** Deepest projected deficit (positive magnitude) anywhere in the horizon — the SQL `v_maxdef`.
   *  Scheduled receipts are already netted into the PAB that produces this, so they are NOT a
   *  separate input here. */
  maxDeficit: number;
  safetyStock: number;
  packSize: number;
}

export interface PurchaseRecommendation {
  /** max(0, maxDeficit + SS), floored at 0 (pre-rounding) — the SQL `v_raw`. */
  rawQty: number;
  /** rawQty rounded UP to the pack/MOQ. */
  qty: number;
  orderToday: boolean;
  message_ar: string;
}

/** Recommended purchase = max(0, maxDeficit + SS), rounded up to pack. Mirrors the live SQL
 *  `v_raw := greatest(0, v_maxdef + v_ss)`; receipts are NOT subtracted (already in the PAB). */
export function recommendPurchase({
  maxDeficit,
  safetyStock,
  packSize,
}: PurchaseRecommendationInput): PurchaseRecommendation {
  const rawQty = Math.max(0, maxDeficit + safetyStock);
  const pack = packSize > 0 ? packSize : 1;
  const qty = Math.ceil(rawQty / pack) * pack;
  const orderToday = qty > 0;
  // The displayed shortage matches the order basis (SQL uses greatest(v_shortfall, v_maxdef) = v_maxdef).
  const message_ar = orderToday
    ? `⚠️ نقص متوقع: ${maxDeficit} كجم الأسبوع القادم. اطلب ${qty} كجم اليوم.`
    : `✅ المخزون كافٍ. لا حاجة للطلب الآن.`;
  return { rawQty, qty, orderToday, message_ar };
}
