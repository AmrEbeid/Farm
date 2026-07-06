export interface PlannedMaterialRequirement {
  id?: string | null;
  item_id?: string | null;
}

export interface MaterialActual {
  requirement_id?: string | null;
  item_id?: string | null;
  actual_qty?: number | string | null;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function materialActualQtyForRequirement(
  requirement: PlannedMaterialRequirement,
  actuals: MaterialActual[] | null | undefined,
  scalarFallback?: number | null,
): number | null {
  if (!actuals || actuals.length === 0) return scalarFallback ?? null;

  const hasRequirementIds = actuals.some((actual) => actual.requirement_id);
  if (requirement.id) {
    const byRequirement = actuals.find((actual) => actual.requirement_id === requirement.id);
    const qty = toFiniteNumber(byRequirement?.actual_qty);
    if (qty != null) return qty;
    if (hasRequirementIds) return null;
  }

  const itemMatches = requirement.item_id ? actuals.filter((actual) => actual.item_id === requirement.item_id) : [];
  if (itemMatches.length === 1) {
    return toFiniteNumber(itemMatches[0].actual_qty);
  }

  return scalarFallback ?? null;
}
