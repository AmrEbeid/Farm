import { moneyNumber } from "./money";

/**
 * Pure helpers for the "/finance/pnl" owner P&L period summary. This is a small, additive slice —
 * NOT a duplicate of the full Stage-7 accounting framework in PR #368 (branch
 * feat/stage-7-accounting-backend, still an unmerged draft, which builds `sales` + a full
 * `/accounting` P&L page). Non-negotiable #6 (docs/CLAUDE.md): owner drawings (مسحوبات) must stay
 * separate from operating expenses and never be silently folded into them.
 *
 * Never fabricates a figure: every number here is either a real query result (parsed defensively)
 * or explicitly reported as unavailable — never a guessed placeholder that looks like real data.
 */

export interface OwnerPnlSummary {
  periodStart: string | null;
  periodEnd: string | null;
  operatingExpenses: number;
  ownerDrawings: number;
  capex: number;
}

function toMoney(value: unknown): number {
  if (typeof value === "number" || typeof value === "string") {
    return moneyNumber(value) ?? 0;
  }
  return 0;
}

function toDateString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Defensively parse the `fn_owner_pnl_summary` RPC's jsonb payload. Missing/malformed fields become
 * 0 (a real "no rows in this period" answer), never `NaN` silently carried into the rendered page.
 */
export function parseOwnerPnlSummary(value: unknown): OwnerPnlSummary {
  const row =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    periodStart: toDateString(row.period_start),
    periodEnd: toDateString(row.period_end),
    operatingExpenses: toMoney(row.operating_expenses),
    ownerDrawings: toMoney(row.owner_drawings),
    capex: toMoney(row.capex),
  };
}

/**
 * Default period = year-to-date (Jan 1 of `now`'s year → `now`), as ISO `date` strings matching the
 * `expenses.date` column type. `now` is injectable so this stays deterministic under test.
 */
export function yearToDatePeriod(now: Date): { from: string; to: string } {
  const year = now.getUTCFullYear();
  return { from: `${year}-01-01`, to: now.toISOString().slice(0, 10) };
}

/**
 * Operating profit = revenue − operating expenses. This repo has no `sales`/revenue table on `main`
 * yet (PR #368 introduces one; still an unmerged draft) — passing `revenue: null` means "no revenue
 * model", and this deliberately returns `null` rather than assuming revenue = 0, which would
 * fabricate a misleadingly negative "profit".
 */
export function operatingProfit(operatingExpenses: number, revenue: number | null): number | null {
  if (revenue == null) return null;
  return revenue - operatingExpenses;
}
