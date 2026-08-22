import {
  compareDecimals,
  multiplyDecimals,
  parseDecimal,
  roundDecimal,
  subtractDecimals,
  type DecimalString,
} from "./decimal";

export const SEASON_DASHBOARD_SNAPSHOT_VERSION = "farm-os.season-dashboard.v1";

export interface SeasonDashboardSummary {
  deliveryCount: number;
  traderCount: number;
  unnamedCount: number;
  unknownQuantityCount: number;
  pendingCount: number;
  pendingUnknownQuantityCount: number;
  invalidRevenueCount: number;
  deliveredQuantity: DecimalString;
  deliveredTons: DecimalString;
  pendingQuantity: DecimalString;
  pendingTons: DecimalString;
  finalizedTotal: DecimalString;
  collectedTotal: DecimalString;
  outstandingTotal: DecimalString;
  collectionPercent: DecimalString | null;
  pickedCrates: DecimalString;
  deliveredCrates: DecimalString;
}

export interface SeasonDeliveryRow {
  id: string;
  eventDate: string;
  crop: string;
  quantity: DecimalString | null;
  unit: string | null;
  amount: DecimalString | null;
  priceStatus: "pending" | "finalized";
  paymentStatus: "unpaid" | "partially_collected" | "collected";
  revenuePosted: boolean;
  buyerId: string | null;
  buyerName: string | null;
  costCenterId: string | null;
  deliveryNoteNo: number | null;
  crates: DecimalString | null;
}

export interface SeasonCenterRow {
  id: string;
  name: string;
  areaFeddan: DecimalString | null;
  deliveryCount: number;
  unknownQuantityCount: number;
  pendingCount: number;
  quantity: DecimalString;
  quantityPerFeddan: DecimalString | null;
  finalizedTotal: DecimalString;
}

export interface SeasonDashboardSnapshot {
  from: string;
  asOf: string;
  rowLimit: number;
  summary: SeasonDashboardSummary;
  rows: SeasonDeliveryRow[];
  centers: SeasonCenterRow[];
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`season snapshot: ${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`season snapshot: field "${key}" must be text`);
  }
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`season snapshot: field "${key}" must be text or null`);
  }
  return value;
}

function integer(row: Record<string, unknown>, key: string, max = Number.MAX_SAFE_INTEGER): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new Error(`season snapshot: field "${key}" is outside its safe range`);
  }
  return value as number;
}

function nullableInteger(row: Record<string, unknown>, key: string): number | null {
  if (row[key] === null) return null;
  return integer(row, key);
}

function boolean(row: Record<string, unknown>, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`season snapshot: field "${key}" must be boolean`);
  }
  return row[key];
}

function decimal(row: Record<string, unknown>, key: string, nullable = false): DecimalString | null {
  if (row[key] === null && nullable) return null;
  if (typeof row[key] !== "string") {
    throw new Error(`season snapshot: field "${key}" must be decimal text${nullable ? " or null" : ""}`);
  }
  const parsed = parseDecimal(row[key]);
  if (parsed === null || compareDecimals(parsed, "0") < 0) {
    throw new Error(`season snapshot: field "${key}" must be a non-negative decimal`);
  }
  return parsed;
}

function calendarDate(row: Record<string, unknown>, key: string): string {
  const value = text(row, key);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`season snapshot: field "${key}" must be a calendar date`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`season snapshot: field "${key}" must be a calendar date`);
  }
  return value;
}

function priceStatus(row: Record<string, unknown>): SeasonDeliveryRow["priceStatus"] {
  if (row.price_status === "pending" || row.price_status === "finalized") return row.price_status;
  throw new Error("season snapshot: price status is invalid");
}

function paymentStatus(row: Record<string, unknown>): SeasonDeliveryRow["paymentStatus"] {
  if (row.payment_status === "unpaid" || row.payment_status === "partially_collected" || row.payment_status === "collected") {
    return row.payment_status;
  }
  throw new Error("season snapshot: payment status is invalid");
}

export function parseSeasonDashboardSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedFrom: string,
  expectedAsOf: string,
): SeasonDashboardSnapshot {
  const payload = object(value, "payload");
  if (payload.version !== SEASON_DASHBOARD_SNAPSHOT_VERSION) {
    throw new Error("season snapshot: version is invalid");
  }
  if (text(payload, "org_id") !== expectedOrgId) {
    throw new Error("season snapshot: organization does not match the active organization");
  }
  const from = calendarDate(payload, "from");
  const asOf = calendarDate(payload, "as_of");
  if (from !== expectedFrom || asOf !== expectedAsOf || from > asOf) {
    throw new Error("season snapshot: requested date window does not match");
  }
  const rowLimit = integer(payload, "row_limit", 400);
  if (rowLimit < 1) throw new Error("season snapshot: row limit must be positive");
  if (integer(payload, "party_mismatch_count") !== 0) {
    throw new Error("season snapshot: party organization is invalid");
  }

  const rawSummary = object(payload.summary, "summary");
  const summary: SeasonDashboardSummary = {
    deliveryCount: integer(rawSummary, "delivery_count"),
    traderCount: integer(rawSummary, "trader_count"),
    unnamedCount: integer(rawSummary, "unnamed_count"),
    unknownQuantityCount: integer(rawSummary, "unknown_qty_count"),
    pendingCount: integer(rawSummary, "pending_count"),
    pendingUnknownQuantityCount: integer(rawSummary, "pending_unknown_qty_count"),
    invalidRevenueCount: integer(rawSummary, "invalid_revenue_count"),
    deliveredQuantity: decimal(rawSummary, "delivered_qty")!,
    deliveredTons: decimal(rawSummary, "delivered_tons")!,
    pendingQuantity: decimal(rawSummary, "pending_qty")!,
    pendingTons: decimal(rawSummary, "pending_tons")!,
    finalizedTotal: decimal(rawSummary, "finalized_total")!,
    collectedTotal: decimal(rawSummary, "collected_total")!,
    outstandingTotal: decimal(rawSummary, "outstanding_total")!,
    collectionPercent: decimal(rawSummary, "collection_percent", true),
    pickedCrates: decimal(rawSummary, "picked_crates")!,
    deliveredCrates: decimal(rawSummary, "delivered_crates")!,
  };
  if (
    summary.pendingCount > summary.deliveryCount ||
    summary.unnamedCount > summary.deliveryCount ||
    summary.unknownQuantityCount > summary.deliveryCount ||
    summary.pendingUnknownQuantityCount > summary.pendingCount ||
    summary.invalidRevenueCount > summary.deliveryCount - summary.pendingCount ||
    summary.traderCount > summary.deliveryCount ||
    compareDecimals(
      subtractDecimals(summary.finalizedTotal, summary.collectedTotal),
      summary.outstandingTotal,
    ) !== 0 ||
    compareDecimals(multiplyDecimals(summary.deliveredTons, "1000"), summary.deliveredQuantity) !== 0 ||
    compareDecimals(multiplyDecimals(summary.pendingTons, "1000"), summary.pendingQuantity) !== 0 ||
    (summary.finalizedTotal === "0") !== (summary.collectionPercent === null) ||
    (summary.collectionPercent !== null && compareDecimals(summary.collectionPercent, "100") > 0)
  ) {
    throw new Error("season snapshot: summary invariants are invalid");
  }
  if (summary.collectionPercent !== null) {
    const expected = multiplyDecimals(summary.collectedTotal, "100");
    const expectedScale = expected.includes(".") ? expected.length - expected.indexOf(".") - 1 : 0;
    const actual = multiplyDecimals(summary.collectionPercent, summary.finalizedTotal);
    if (compareDecimals(roundDecimal(actual, expectedScale), expected) !== 0) {
      throw new Error("season snapshot: collection percentage is inconsistent");
    }
  }

  if (!Array.isArray(payload.rows)) throw new Error("season snapshot: rows must be an array");
  const seenRows = new Set<string>();
  const rows = payload.rows.map((raw, index): SeasonDeliveryRow => {
    const row = object(raw, `row ${index}`);
    const item: SeasonDeliveryRow = {
      id: text(row, "id"),
      eventDate: calendarDate(row, "event_date"),
      crop: text(row, "crop"),
      quantity: decimal(row, "quantity", true),
      unit: nullableText(row, "unit"),
      amount: decimal(row, "amount", true),
      priceStatus: priceStatus(row),
      paymentStatus: paymentStatus(row),
      revenuePosted: boolean(row, "revenue_posted"),
      buyerId: nullableText(row, "buyer_id"),
      buyerName: nullableText(row, "buyer_name"),
      costCenterId: nullableText(row, "cost_center_id"),
      deliveryNoteNo: nullableInteger(row, "delivery_note_no"),
      crates: decimal(row, "crates", true),
    };
    if (seenRows.has(item.id)) throw new Error(`season snapshot: duplicate row ${item.id}`);
    seenRows.add(item.id);
    if (item.eventDate < from || item.eventDate > asOf) {
      throw new Error("season snapshot: delivery date is outside the requested window");
    }
    if ((item.buyerId === null) !== (item.buyerName === null)) {
      throw new Error("season snapshot: buyer id and name must be present together");
    }
    if (
      (item.priceStatus === "pending" && (item.revenuePosted || item.amount !== null)) ||
      (item.priceStatus === "finalized" && item.revenuePosted !== (item.amount !== null))
    ) {
      throw new Error("season snapshot: sale price state and amount disagree");
    }
    return item;
  });
  if (rows.length !== Math.min(summary.deliveryCount, rowLimit)) {
    throw new Error("season snapshot: delivery sample is incomplete");
  }

  if (!Array.isArray(payload.centers)) throw new Error("season snapshot: centers must be an array");
  const seenCenters = new Set<string>();
  let centerDeliveries = 0;
  const centers = payload.centers.map((raw, index): SeasonCenterRow => {
    const row = object(raw, `center ${index}`);
    const item: SeasonCenterRow = {
      id: text(row, "id"),
      name: text(row, "name"),
      areaFeddan: decimal(row, "area_feddan", true),
      deliveryCount: integer(row, "delivery_count"),
      unknownQuantityCount: integer(row, "unknown_qty_count"),
      pendingCount: integer(row, "pending_count"),
      quantity: decimal(row, "quantity")!,
      quantityPerFeddan: decimal(row, "quantity_per_feddan", true),
      finalizedTotal: decimal(row, "finalized_total")!,
    };
    if (seenCenters.has(item.id)) throw new Error(`season snapshot: duplicate center ${item.id}`);
    seenCenters.add(item.id);
    if (
      item.unknownQuantityCount > item.deliveryCount ||
      item.pendingCount > item.deliveryCount ||
      (item.quantityPerFeddan !== null && (item.areaFeddan === null || item.areaFeddan === "0"))
    ) {
      throw new Error("season snapshot: center invariants are invalid");
    }
    centerDeliveries += item.deliveryCount;
    return item;
  });
  if (centerDeliveries > summary.deliveryCount) {
    throw new Error("season snapshot: center delivery count exceeds the season total");
  }

  return { from, asOf, rowLimit, summary, rows, centers };
}
