// Stage 8 (SPEC-0006 §4.2) — payroll computation engine. PURE + PII-free: it works on abstract
// personId + rate, so it carries no wages/PII itself and is unit-tested against a hand-computed fixture
// (the reconciliation oracle). The gated remainder — the labor_logs/payroll tables, the idempotent
// transactional RPC, the owner/accountant RLS, and the REQUIRED independent access review — wraps this
// engine but is NOT in this slice (real payroll data is Stage M, behind the privacy review).
//
// Non-negotiable #1: a missing/invalid rate is FLAGGED, never fabricated — that line computes to 0 and
// surfaces in `missingRates` so a human supplies the rate; payroll never invents a wage.

export interface LaborEntry {
  personId: string;
  hours: number;
}

export interface PayrollLine {
  personId: string;
  hours: number;
  rate: number | null; // null ⇒ no valid rate on file (flagged, not fabricated)
  gross: number; // hours × rate, rounded to 2dp; 0 when the rate is missing
  rateMissing: boolean;
}

export interface PayrollRun {
  lines: PayrollLine[];
  total: number;
  missingRates: string[]; // personIds with hours but no usable rate — block close until resolved
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute a payroll run: gross per person = Σ(hours × rate) over the period's labor entries. Pure and
 * deterministic (same input → same output — the foundation the RPC's idempotent claim-first close
 * builds on). Garbage hours (negative / non-finite) are ignored; a missing/invalid rate flags the line
 * (gross 0) rather than inventing a wage.
 */
export function computePayroll(labor: LaborEntry[], rates: Map<string, number>): PayrollRun {
  // 1) aggregate valid hours per person
  const hoursByPerson = new Map<string, number>();
  for (const e of labor) {
    if (!e || typeof e.personId !== "string" || !e.personId) continue;
    if (typeof e.hours !== "number" || !Number.isFinite(e.hours) || e.hours < 0) continue;
    hoursByPerson.set(e.personId, (hoursByPerson.get(e.personId) ?? 0) + e.hours);
  }

  // 2) apply rates (sorted for a stable, deterministic line order)
  const lines: PayrollLine[] = [];
  const missingRates: string[] = [];
  let total = 0;
  for (const personId of [...hoursByPerson.keys()].sort()) {
    const hours = r2(hoursByPerson.get(personId)!);
    const rate = rates.get(personId);
    // A zero or negative rate is invalid: paying logged hours nothing without flagging is the harmful
    // direction (non-negotiable #1). Flag it (rate: null, rateMissing: true) so a human supplies it.
    if (rate === undefined || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      missingRates.push(personId);
      lines.push({ personId, hours, rate: null, gross: 0, rateMissing: true });
      continue;
    }
    const gross = r2(hours * rate);
    total += gross;
    lines.push({ personId, hours, rate, gross, rateMissing: false });
  }

  return { lines, total: r2(total), missingRates };
}

// ---------------------------------------------------------------------------------------------
// PLANNED labor cost rollup (labor cost basis, plan_labor_requirements.person_id). Distinct from
// computePayroll above (which aggregates ACTUAL hours per person across a payroll run): this rolls up
// PLANNED labor lines — count workers × days, optionally linked to a person for a daily-rate lookup —
// into a per-line/per-operation cost estimate for the planned-vs-actual report. Same non-negotiable #1:
// a missing/invalid/unauthorized rate is FLAGGED ("unpriced"), never fabricated. A free-text line (no
// person_id — SPEC-0006 §3: informal/day-labor crews not yet in `people`) is ALWAYS unpriced; it is not
// an error, just an honestly unknown cost. `rates` is supplied by the caller from an RLS-scoped read of
// people_compensation (payroll.read-gated, SPEC-0006) — a caller without that permission simply passes
// an empty map, so every person-linked line comes back unpriced too: this function never sees, and so
// can never leak, a wage it isn't authorized to have read.

export interface LaborRequirementCostInput {
  id: string;
  count: number | null;
  days: number | null;
  personId: string | null;
}

export interface LaborRequirementCost {
  id: string;
  manDays: number; // count × days, 0 when either is missing/invalid — never negative
  cost: number | null; // null ⇒ unpriced (no person_id, or no rate visible/on file for this person)
}

export interface LaborCostRollup {
  lines: LaborRequirementCost[];
  total: number; // sum of the KNOWN per-line costs only — see hasUnpriced before treating this as complete
  unpricedCount: number;
  hasUnpriced: boolean;
}

const nonNegNumber = (n: number | null | undefined): number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;

/**
 * Roll up planned labor cost for one operation's plan_labor_requirements lines. `rates` maps
 * personId → daily rate (people_compensation.rate — SPEC-0006 treats the stored rate as a per-day
 * figure, matching plan_labor_requirements' count-workers × days shape; the #388 wage-model memo may
 * formalize hourly/piece/seasonal modes later, but daily-rate × days is the ratified SPEC-0006 default).
 */
export function computeLaborCostRollup(
  lines: LaborRequirementCostInput[],
  rates: Map<string, number>,
): LaborCostRollup {
  const out: LaborRequirementCost[] = [];
  let total = 0;
  let unpricedCount = 0;

  for (const line of lines) {
    const manDays = r2(nonNegNumber(line.count) * nonNegNumber(line.days));

    let cost: number | null = null;
    if (line.personId) {
      const rate = rates.get(line.personId);
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        cost = r2(manDays * rate);
      }
    }

    if (cost == null) {
      unpricedCount += 1;
    } else {
      total += cost;
    }
    out.push({ id: line.id, manDays, cost });
  }

  return { lines: out, total: r2(total), unpricedCount, hasUnpriced: unpricedCount > 0 };
}
