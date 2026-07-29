// Payroll run reading — the bounded, org-scoped, fail-closed reads behind «إقفال الرواتب»
// (SPEC-0006 slice 3, migration 20260729090000_payroll_run_persistence.sql).
//
// READ-ONLY. Every call here is a SELECT through the USER-SESSION client, so `payroll_read`
// (org_id ∈ user_org_ids() AND authorize('payroll.read', org_id) — owner/accountant) applies in
// Postgres exactly as it does to any other query the caller could make. The `.eq("org_id", …)`
// filters below are defence-in-depth on top of RLS, never the primary control, and the org id always
// comes from the server session (`requireRole(...).orgId`), never from a URL or a form field.
//
// BOUNDED, NEVER N+1. The history is one query for the runs plus ONE query for their lines; the
// report is one query for the run, ONE for its lines and ONE for the names they reference. Nothing
// loops a query per row. Every list is fetched with LIMIT = max + 1 so an overflow is DETECTED
// rather than silently truncated.
//
// FAIL-CLOSED. A missing run, a failed read, an over-large run and a run with no lines are all
// refusals that render NO figures. A payroll report that silently drops lines would still look like
// a complete wage total, and would be read as one — so a partial one is never produced.
//
// NO CONTACT PII. `people` is read for `id, name` only. Phone/email are PII-locked (SPEC-0048) and
// are never selected here, not even to be discarded.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types.ext";
import { moneyNumber } from "@/lib/money";
import { WAGE_MODE_AR, WAGE_UNIT_AR } from "@/lib/wage-modes";
import { isUuid } from "@/lib/reconciliation review";

export { isUuid };

/** How many closed runs the history lists. Recent history, not an archive browser. */
export const PAYROLL_RUN_HISTORY_LIMIT = 20;

/** The largest report this page will render. Beyond it the report is refused, never truncated. */
export const PAYROLL_RUN_LINES_MAX = 500;
/** Fetch bound = max + 1, so "more than the maximum" is observable in the returned rows. */
export const PAYROLL_RUN_LINES_FETCH = PAYROLL_RUN_LINES_MAX + 1;

/**
 * The bound on the ONE query that counts lines across the listed history. Exceeding it means the
 * counts column cannot be computed exactly, so it renders «—» for every row rather than a number
 * that might be wrong — the history's periods, times and totals stay fully truthful either way.
 */
export const PAYROLL_HISTORY_LINE_MAX = 2000;
export const PAYROLL_HISTORY_LINE_FETCH = PAYROLL_HISTORY_LINE_MAX + 1;

/**
 * Wage modes (#388) and piece units, as they are stored. Both label maps come from
 * `lib/wage-modes.ts` — the same source the attendance form and the compensation editor read — so a
 * mode can never be labelled one way where it is ENTERED and another way on the frozen report that
 * prices it.
 */
export const PAYROLL_MODE_AR: Record<string, string> = WAGE_MODE_AR;

/** Piece-rate units — the CHECK-constrained set on both people_compensation and payroll_run_lines. */
export const PAYROLL_UNIT_AR: Record<string, string> = WAGE_UNIT_AR;

/** What the frozen `quantity` counts, per mode. A piece line names its own unit instead. */
const PAYROLL_QUANTITY_UNIT_AR: Record<string, string> = {
  hourly: "ساعة",
  daily: "يوم",
  seasonal: "فترة",
};

/** Shown when a stored mode/unit is not one this build knows — never guessed at. */
export const PAYROLL_UNKNOWN_LABEL_AR = "غير معروف";

export function payrollModeLabel(mode: string): string {
  return PAYROLL_MODE_AR[mode] ?? PAYROLL_UNKNOWN_LABEL_AR;
}

/** The unit the line's quantity is measured in: the piece unit, or the mode's own natural unit. */
export function payrollQuantityUnitLabel(mode: string, unit: string | null): string {
  if (mode !== "piece") return PAYROLL_QUANTITY_UNIT_AR[mode] ?? PAYROLL_UNKNOWN_LABEL_AR;
  if (!unit) return PAYROLL_UNKNOWN_LABEL_AR;
  return PAYROLL_UNIT_AR[unit] ?? PAYROLL_UNKNOWN_LABEL_AR;
}

export interface PayrollRunSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string;
  totalGross: number | null;
}

export interface PayrollHistoryRow extends PayrollRunSummary {
  /** null when the bounded counting query overflowed — rendered «—», never fabricated. */
  lineCount: number | null;
}

export interface PayrollRunLineView {
  personId: string;
  /** The person's name, or PAYROLL_UNKNOWN_LABEL_AR when it is not readable. Never a raw id. */
  personName: string;
  mode: string;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  gross: number | null;
}

export const PAYROLL_HISTORY_FAILED_AR = "تعذّر قراءة سجل الإقفالات السابقة.";
export const PAYROLL_REPORT_READ_FAILED_AR = "تعذّر قراءة تقرير الإقفال. لم تُعرض أي أرقام.";
export const PAYROLL_REPORT_OVERFLOW_AR =
  "هذا الإقفال أكبر من الحد الذي تعرضه هذه الصفحة (٥٠٠ سطر)، ولن يُعرض جزئيًا.";
export const PAYROLL_REPORT_EMPTY_AR =
  "لا يحمل هذا الإقفال أي سطر أجر مقروء، فلا يوجد تقرير يُعرض.";

export type PayrollHistoryLoad =
  | { ok: true; runs: PayrollHistoryRow[] }
  | { ok: false; error: string };

export type PayrollRunLoad =
  | { ok: true; run: PayrollRunSummary; lines: PayrollRunLineView[] }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "read_failed" | "overflow" | "empty"; error: string };

const HISTORY_FAILED: PayrollHistoryLoad = { ok: false, error: PAYROLL_HISTORY_FAILED_AR };
const REPORT_READ_FAILED: PayrollRunLoad = {
  ok: false,
  kind: "read_failed",
  error: PAYROLL_REPORT_READ_FAILED_AR,
};

/** The stored columns each read asks for. Named once so the tests pin the exact projection. */
export const PAYROLL_RUN_COLUMNS = "id, period_start, period_end, closed_at, total_gross" as const;
export const PAYROLL_LINE_COLUMNS = "person_id, mode, unit, quantity, rate, gross" as const;
/** `people` is read for the display name ONLY — no phone, no email (PII-locked, SPEC-0048). */
export const PAYROLL_PERSON_COLUMNS = "id, name" as const;

type RunRow = {
  id: string;
  period_start: string;
  period_end: string;
  closed_at: string;
  total_gross: number;
};

function toSummary(row: RunRow): PayrollRunSummary {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    closedAt: row.closed_at,
    totalGross: moneyNumber(row.total_gross),
  };
}

/**
 * The most recent closed runs for the ACTIVE org, newest period first, with each run's line count.
 *
 * Two queries total, regardless of how many runs come back: the runs, then one `in(run_id, …)` read
 * that counts their lines. A failure in either read is a refusal for the history as a whole (the
 * count query degrades to «—» instead, since the runs themselves are still fully truthful).
 */
export async function loadPayrollRunHistory(
  sb: SupabaseClient<Database>,
  orgId: string,
): Promise<PayrollHistoryLoad> {
  if (!isUuid(orgId)) return HISTORY_FAILED;

  const { data: runRows, error: runError } = await sb
    .from("payroll_runs")
    .select(PAYROLL_RUN_COLUMNS)
    .eq("org_id", orgId)
    .order("period_start", { ascending: false })
    .order("period_end", { ascending: false })
    .limit(PAYROLL_RUN_HISTORY_LIMIT);
  if (runError) return HISTORY_FAILED;

  const runs = runRows ?? [];
  if (runs.length === 0) return { ok: true, runs: [] };

  const { data: lineRows, error: lineError } = await sb
    .from("payroll_run_lines")
    .select("run_id")
    .eq("org_id", orgId)
    .in(
      "run_id",
      runs.map((run) => run.id),
    )
    .limit(PAYROLL_HISTORY_LINE_FETCH);

  // An overflow or a failed count is NOT a reason to hide the runs — but it is a reason never to
  // print a count that might be wrong. Both degrade the column to «—» for every row.
  const counted = !lineError && (lineRows ?? []).length <= PAYROLL_HISTORY_LINE_MAX;
  const countByRun = new Map<string, number>();
  if (counted) {
    for (const line of lineRows ?? []) {
      countByRun.set(line.run_id, (countByRun.get(line.run_id) ?? 0) + 1);
    }
  }

  return {
    ok: true,
    runs: runs.map((run) => ({
      ...toSummary(run),
      lineCount: counted ? (countByRun.get(run.id) ?? 0) : null,
    })),
  };
}

/**
 * One closed run and its frozen snapshot lines, for the report page.
 *
 * Order of checks — each one closes rather than degrades:
 *   1. A malformed run id or org id never reaches PostgREST (a bad uuid would 22P02).
 *   2. The run is read org-scoped; missing (or cross-org, which RLS makes indistinguishable from
 *      missing) is a 404, not an error page.
 *   3. Lines are read with LIMIT = max + 1: more than PAYROLL_RUN_LINES_MAX refuses the report.
 *   4. Zero lines refuses too. `fn_close_payroll_run` never writes a run without lines (it aborts on
 *      empty input, on an unassigned crew and on any missing rate before its first write), so an
 *      empty read means the read is incomplete — not that the wage bill was zero.
 *   5. Names are resolved in ONE bounded org-scoped query keyed on the ids the lines already carry.
 */
export async function loadPayrollRunDetail(
  sb: SupabaseClient<Database>,
  runId: string,
  orgId: string,
): Promise<PayrollRunLoad> {
  if (!isUuid(runId)) return { ok: false, kind: "not_found" };
  // A malformed org id is a caller bug, not a missing run — it must not read as "no such run".
  if (!isUuid(orgId)) return REPORT_READ_FAILED;

  const { data: runRow, error: runError } = await sb
    .from("payroll_runs")
    .select(PAYROLL_RUN_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", runId)
    .maybeSingle();
  if (runError) return REPORT_READ_FAILED;
  if (!runRow) return { ok: false, kind: "not_found" };

  const { data: lineRows, error: lineError } = await sb
    .from("payroll_run_lines")
    .select(PAYROLL_LINE_COLUMNS)
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .order("person_id")
    .order("mode")
    .order("unit")
    .limit(PAYROLL_RUN_LINES_FETCH);
  if (lineError) return REPORT_READ_FAILED;

  const lines = lineRows ?? [];
  if (lines.length > PAYROLL_RUN_LINES_MAX) {
    return { ok: false, kind: "overflow", error: PAYROLL_REPORT_OVERFLOW_AR };
  }
  if (lines.length === 0) return { ok: false, kind: "empty", error: PAYROLL_REPORT_EMPTY_AR };

  const personIds = [...new Set(lines.map((line) => line.person_id))];
  const { data: personRows, error: personError } = await sb
    .from("people")
    .select(PAYROLL_PERSON_COLUMNS)
    .eq("org_id", orgId)
    .in("id", personIds)
    .limit(PAYROLL_RUN_LINES_FETCH);
  if (personError) return REPORT_READ_FAILED;

  const nameById = new Map((personRows ?? []).map((person) => [person.id, person.name]));

  return {
    ok: true,
    run: toSummary(runRow),
    lines: lines.map((line) => ({
      personId: line.person_id,
      // A frozen line always references a same-org person (payroll_run_lines' tenant guard), so an
      // unresolved name is a read gap, not a cross-tenant leak. It reads as «غير معروف» rather than
      // exposing the raw uuid on a printed wage report.
      personName: nameById.get(line.person_id)?.trim() || PAYROLL_UNKNOWN_LABEL_AR,
      mode: line.mode,
      unit: line.unit,
      quantity: moneyNumber(line.quantity),
      rate: moneyNumber(line.rate),
      gross: moneyNumber(line.gross),
    })),
  };
}
