export interface CoverageDemandRow {
  plan_id: string | null | undefined;
  planned_at: string | null | undefined;
}

export interface CoverageDemandContext {
  planId: string | null;
  plannedAt: string | null;
}

function demandSortKey(plannedAt: string | null | undefined): string {
  return plannedAt ? String(plannedAt) : "9999-12-31T23:59:59.999Z";
}

/**
 * Resolve whether a coverage-created PR can be safely attached to one plan.
 * If no plan or multiple plans demand the item, keep the PR planless instead of
 * stamping budget/reserve state onto a possibly wrong plan.
 */
export function coverageDemandContext(rows: CoverageDemandRow[]): CoverageDemandContext {
  const sorted = [...rows].sort((a, b) => demandSortKey(a.planned_at).localeCompare(demandSortKey(b.planned_at)));
  const planIds = new Set(sorted.map((row) => row.plan_id).filter((planId): planId is string => Boolean(planId)));
  return {
    planId: planIds.size === 1 ? [...planIds][0] : null,
    plannedAt: sorted[0]?.planned_at ? String(sorted[0].planned_at) : null,
  };
}

/**
 * Derive the PR `needed_by` date for a coverage-created purchase request from the
 * live demand operation date. Mirrors fn_stock_coverage's forward anchor:
 * past/null/planless demand is period-1 demand, so an approved PO must be due
 * today or later to be projected as scheduled supply.
 */
export function coveragePrNeededBy(
  plannedAt: string | null | undefined,
  todayKey = new Date().toISOString().slice(0, 10),
): string {
  const plannedKey = plannedAt ? String(plannedAt).slice(0, 10) : null;
  return plannedKey && plannedKey > todayKey ? plannedKey : todayKey;
}
