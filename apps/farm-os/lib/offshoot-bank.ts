export type OffshootMovementType = "produce" | "plant" | "sell" | "replant";

export interface OffshootMovementInput {
  id: string;
  movement_date: string | null;
  movement_type: OffshootMovementType;
  qty: number | string;
  source_cost_center_id: string | null;
  dest_cost_center_id: string | null;
  note: string | null;
}

export interface OffshootCostCenterInput {
  id: string;
  code: string;
  name_ar: string;
}

export interface OffshootValuationInput {
  low_per_unit: number | string | null;
  high_per_unit: number | string | null;
}

export const OFFSHOOT_TYPE_AR: Record<OffshootMovementType, string> = {
  produce: "إنتاج",
  plant: "زراعة",
  sell: "بيع",
  replant: "إحلال",
};

const TYPE_ORDER: OffshootMovementType[] = ["produce", "plant", "replant", "sell"];

function asNumber(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function centerLabel(center: OffshootCostCenterInput | undefined): string {
  return center ? `${center.code} · ${center.name_ar}` : "—";
}

export function buildOffshootBankSummary({
  movements,
  costCenters,
  valuation,
}: {
  movements: OffshootMovementInput[];
  costCenters: OffshootCostCenterInput[];
  valuation?: OffshootValuationInput | null;
}) {
  const centerById = new Map(costCenters.map((center) => [center.id, center]));
  const totals = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0])) as Record<OffshootMovementType, number>;
  const byDestination = new Map<string, { id: string; center: string; planted: number; replanted: number; total: number }>();

  for (const movement of movements) {
    const qty = asNumber(movement.qty);
    totals[movement.movement_type] += qty;
    if ((movement.movement_type === "plant" || movement.movement_type === "replant") && movement.dest_cost_center_id) {
      const center = centerById.get(movement.dest_cost_center_id);
      const key = movement.dest_cost_center_id;
      const row = byDestination.get(key) ?? {
        id: key,
        center: centerLabel(center),
        planted: 0,
        replanted: 0,
        total: 0,
      };
      if (movement.movement_type === "plant") row.planted += qty;
      else row.replanted += qty;
      row.total += qty;
      byDestination.set(key, row);
    }
  }

  const remaining = totals.produce - totals.plant - totals.replant - totals.sell;
  const lowPerUnit = valuation ? asNumber(valuation.low_per_unit) : null;
  const highPerUnit = valuation ? asNumber(valuation.high_per_unit) : null;

  return {
    totals,
    produced: totals.produce,
    planted: totals.plant,
    replanted: totals.replant,
    sold: totals.sell,
    remaining,
    hasNegativeBalance: remaining < 0,
    lowPerUnit,
    highPerUnit,
    estimatedLow: lowPerUnit == null ? null : Math.max(0, remaining) * lowPerUnit,
    estimatedHigh: highPerUnit == null ? null : Math.max(0, remaining) * highPerUnit,
    typeChartRows: TYPE_ORDER.map((type) => ({ type: OFFSHOOT_TYPE_AR[type], qty: totals[type] })),
    destinationRows: [...byDestination.values()].sort((a, b) => b.total - a.total || a.center.localeCompare(b.center, "ar")),
    movementRows: movements.map((movement) => ({
      id: movement.id,
      movementType: movement.movement_type,
      date: movement.movement_date ?? "",
      type: OFFSHOOT_TYPE_AR[movement.movement_type],
      qty: asNumber(movement.qty),
      source: centerLabel(centerById.get(movement.source_cost_center_id ?? "")),
      destination: centerLabel(centerById.get(movement.dest_cost_center_id ?? "")),
      note: movement.note ?? "—",
    })),
  };
}
