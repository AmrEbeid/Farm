export interface PlanCostInput {
  est_cost: number | string | null | undefined;
  status?: string | null;
  subtype?: string | null;
}

export interface PlannedCostSummary {
  knownCost: number;
  unknownCostCount: number;
  hasUnknownCost: boolean;
}

export function summarizePlannedFertilizationCost(ops: PlanCostInput[]): PlannedCostSummary {
  let knownCost = 0;
  let unknownCostCount = 0;

  for (const op of ops) {
    if (op.subtype !== "fertilization" || op.status !== "planned") continue;

    if (op.est_cost == null) {
      unknownCostCount += 1;
      continue;
    }

    const cost = Number(op.est_cost);
    if (!Number.isFinite(cost)) {
      unknownCostCount += 1;
      continue;
    }

    knownCost += cost;
  }

  return {
    knownCost,
    unknownCostCount,
    hasUnknownCost: unknownCostCount > 0,
  };
}

export function budgetCheckResultForKnownCost(
  available: number,
  knownCost: number,
  hasUnknownCost: boolean,
): "ok" | "warn" | "block" {
  const after = available - knownCost;
  if (after < 0) return "block";
  if (hasUnknownCost) return "warn";
  return after < available * 0.2 ? "warn" : "ok";
}
