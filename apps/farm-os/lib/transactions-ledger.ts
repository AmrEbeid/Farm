// «المعاملات» (SPEC-0025 U-3) — pure helpers for the unified transactions ledger. The page itself
// stays the source of truth for the actual queries; these are the parts worth testing in isolation:
// the lifecycle filters that decide which rows are "visible", the exact-count fail-closed guard, the
// deterministic sort, and the truncation checks that gate CSV export.

/** Every source/lookup query is capped here — exact counts (not this cap) drive chips and sums. */
export const TX_ROW_LIMIT = 400;

// Mirrors fn_owner_pnl_summary's `coalesce(payment_status, '') not in ('cancelled', 'historical_reversed')`
// (supabase/migrations/20260726150000...sql): a null payment_status (never routed yet) stays visible,
// only an explicitly cancelled or reversed-out expense is hidden. Postgres's own `NOT IN` would drop
// null rows (NULL NOT IN (...) is NULL, not true), so the PostgREST filter is an explicit `.or()` of
// "is null" and "not in the hidden set" rather than a bare `.not("payment_status", "in", ...)`.
export const EXPENSE_HIDDEN_PAYMENT_STATUSES = ["cancelled", "historical_reversed"] as const;
export const EXPENSE_VISIBLE_LIFECYCLE_FILTER =
  `payment_status.is.null,payment_status.not.in.(${EXPENSE_HIDDEN_PAYMENT_STATUSES.join(",")})`;

export function isVisibleExpensePaymentStatus(status: string | null | undefined): boolean {
  if (status == null) return true;
  return !(EXPENSE_HIDDEN_PAYMENT_STATUSES as readonly string[]).includes(status);
}

// A reconciliation-reversed sale's revenue journal is reversed, so listing it as a positive incoming
// row would double-count it against its replacement (migration 20260726160000). sales.payment_status
// is `not null default 'unpaid'`, so a plain `.neq()` never silently drops a null row.
export const SALE_HIDDEN_PAYMENT_STATUS = "historical_reversed";

export function isVisibleSalePaymentStatus(status: string | null | undefined): boolean {
  return status !== SALE_HIDDEN_PAYMENT_STATUS;
}

export interface ExactCountResult {
  count: number | null;
  error: unknown;
}

/**
 * Fails closed: an error, or an exact count missing from a `{ count: "exact" }` response, must
 * never be read as "zero rows" — that would understate the ledger instead of surfacing the failure.
 */
export function requireExactCount(res: ExactCountResult, label: string): number {
  if (res.error) throw res.error;
  if (res.count == null || !Number.isSafeInteger(res.count) || res.count < 0) {
    throw new Error(`${label}: exact count missing or invalid in response`);
  }
  return res.count;
}

export interface SortableTxRow {
  id: string;
  sortDate: string;
}

/**
 * Deterministic ledger order: most recent date first, nulls (empty sortDate) last, then id
 * descending as a stable tiebreak — so rows sharing a date (or all missing one) don't reorder
 * between requests or across the four merged sources.
 */
export function compareTxByDateThenId(a: SortableTxRow, b: SortableTxRow): number {
  const dateCmp = String(b.sortDate).localeCompare(String(a.sortDate));
  if (dateCmp !== 0) return dateCmp;
  return String(b.id).localeCompare(String(a.id));
}

/** A source is truncated once its exact count exceeds the bounded page actually fetched. */
export function isTypeTruncated(exactCount: number, limit: number = TX_ROW_LIMIT): boolean {
  return exactCount > limit;
}

/** For the unfiltered "الكل" view: truncated if ANY merged source is individually truncated. */
export function isAnySourceTruncated(counts: number[], limit: number = TX_ROW_LIMIT): boolean {
  return counts.some((count) => isTypeTruncated(count, limit));
}

/**
 * Unique, non-null referenced ids in first-seen order. The lookup fetch (buyers/suppliers/custody
 * accounts) must cover exactly this set — never the whole org table — so it stays bounded by the
 * displayed rows instead of growing with every buyer/supplier the org has ever recorded.
 */
export function dedupeReferencedIds(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (value == null || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

/**
 * Resolves a referenced id to its lookup name. A genuinely null id (no party) renders as "—". A
 * non-null id with no matching lookup row fails closed instead of silently rendering "—" as if it
 * meant "no party" — that would mask a lookup gap (e.g. the lookup fetch missed an id) as an honest
 * absence (CLAUDE.md #1: never fabricate/hide financial data).
 */
export function requireLookupName(
  id: string | null | undefined,
  nameById: Map<string, string>,
  label: string,
): string {
  if (id == null) return "—";
  const name = nameById.get(id);
  if (name == null) {
    throw new Error(`${label}: no matching lookup row for referenced id ${id}`);
  }
  return name;
}
