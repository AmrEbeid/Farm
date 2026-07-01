/**
 * Purchase-request console classification — the buyer's open-orders view.
 *
 * The "counted in coverage" rule MUST mirror the engine's supply filter in
 * `fn_stock_coverage` (supabase/migrations/20260701200000_engine_clamp_bucket_origin.sql,
 * receipts block): a PR contributes projected supply only when
 *   status in ('approved','partially_received')
 *   and needed_by is not null
 *   and needed_by >= greatest(v_period_start, current_date)
 *   and remaining qty (qty - received_qty) > 0.
 * From the console's page-level perspective (no plan window), `current_date` is
 * the binding floor, so an open order whose needed_by has passed (or was never
 * set) has silently stopped counting as supply — the exact condition the
 * «لا يُحسب في التغطية» badge exists to surface (INVENTORY-360 gap #8: the
 * detail-page overdue banner uses a different rule, so a PO can stop counting
 * with no visible signal anywhere).
 *
 * Pure module: no Date.now() — callers inject `today` (yyyy-mm-dd) so the page
 * controls the clock and tests are deterministic.
 */

export type PrConsoleItem = {
  qty: number | null;
  received_qty: number | null;
};

export type PrConsoleRow = {
  status: string;
  needed_by: string | null; // ISO date (yyyy-mm-dd) or null
  items: PrConsoleItem[];
};

export type PrClassification = {
  /** Not yet in a terminal state (received / rejected). */
  isOpen: boolean;
  /** Submitted, waiting for the owner's approval. */
  isAwaitingApproval: boolean;
  /** Approved or partially received — a live order on a supplier. */
  isOpenOrder: boolean;
  /** Past its needed_by date and still not fully received. */
  isOverdue: boolean;
  /** Open order the coverage engine no longer counts as incoming supply. */
  isStaleForCoverage: boolean;
  /** Σ max(qty − received_qty, 0) across items; 0 when nothing remains. */
  remainingQty: number;
};

const TERMINAL_STATUSES = new Set(["received", "rejected"]);
const OPEN_ORDER_STATUSES = new Set(["approved", "partially_received"]);
const OVERDUE_ELIGIBLE = new Set(["submitted", "approved", "partially_received"]);

export function remainingQty(items: PrConsoleItem[]): number {
  let sum = 0;
  for (const it of items) {
    const qty = it.qty ?? 0;
    const received = it.received_qty ?? 0;
    sum += Math.max(qty - received, 0);
  }
  return sum;
}

export function classifyPr(pr: PrConsoleRow, today: string): PrClassification {
  const remaining = remainingQty(pr.items);
  const isOpen = !TERMINAL_STATUSES.has(pr.status);
  const isAwaitingApproval = pr.status === "submitted";
  const isOpenOrder = OPEN_ORDER_STATUSES.has(pr.status) && remaining > 0;

  // Overdue: the farm asked for it by a date that has passed, and it has not
  // fully arrived. Drafts are excluded (nothing was requested yet); terminal
  // states are excluded by definition.
  const isOverdue =
    OVERDUE_ELIGIBLE.has(pr.status) &&
    pr.needed_by !== null &&
    pr.needed_by < today &&
    remaining > 0;

  // Engine mirror (see header comment): needed_by null OR < today drops the PR
  // from projected supply even though it is still a live order.
  const isStaleForCoverage =
    OPEN_ORDER_STATUSES.has(pr.status) &&
    remaining > 0 &&
    (pr.needed_by === null || pr.needed_by < today);

  return { isOpen, isAwaitingApproval, isOpenOrder, isOverdue, isStaleForCoverage, remainingQty: remaining };
}

export type PrConsoleFilter = "all" | "submitted" | "open" | "overdue" | "stale";

export function matchesFilter(c: PrClassification, filter: PrConsoleFilter): boolean {
  switch (filter) {
    case "submitted":
      return c.isAwaitingApproval;
    case "open":
      return c.isOpenOrder;
    case "overdue":
      return c.isOverdue;
    case "stale":
      return c.isStaleForCoverage;
    case "all":
    default:
      return true;
  }
}

export function parsePrConsoleFilter(raw: string | undefined): PrConsoleFilter {
  switch (raw) {
    case "submitted":
    case "open":
    case "overdue":
    case "stale":
      return raw;
    default:
      return "all";
  }
}
