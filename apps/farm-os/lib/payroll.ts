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
