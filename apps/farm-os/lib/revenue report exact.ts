import { decimalToSafeNumber, parseDecimal, type DecimalString } from "@/lib/decimal";

export type SalePaymentStatus =
  | "unpaid"
  | "partially_collected"
  | "collected"
  | "historical_treasury"
  | "historical_reversed";

export interface RevenueSaleRow {
  sale_id: string;
  report_date: string;
  sale_date: string | null;
  delivery_date: string | null;
  crop: string;
  season: string | null;
  qty: DecimalString | null;
  unit: string | null;
  unit_price: DecimalString | null;
  total: DecimalString | null;
  price_status: "pending" | "finalized";
  payment_status: SalePaymentStatus;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_type: string | null;
  cost_center_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  farm_name: string | null;
  sector_name: string | null;
  hawsha_name: string | null;
  collected_to_as_of: DecimalString;
  collected_in_period: DecimalString;
  outstanding: DecimalString | null;
}

export interface RevenueBuyerRow {
  buyer_id: string | null;
  buyer_name: string;
  buyer_type: string | null;
  sale_count: number;
  pending_count: number;
  qty: DecimalString;
  finalized_revenue: DecimalString;
  collected_in_period: DecimalString;
  collected_to_as_of: DecimalString;
  outstanding: DecimalString;
}

export interface RevenueCropRow {
  crop: string;
  season: string;
  sale_count: number;
  pending_count: number;
  qty: DecimalString;
  finalized_revenue: DecimalString;
  collected_in_period: DecimalString;
  outstanding: DecimalString;
}

export interface RevenueArRow {
  sale_id: string;
  report_date: string;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_type: string | null;
  crop: string;
  season: string | null;
  total: DecimalString;
  collected_to_as_of: DecimalString;
  outstanding: DecimalString;
  age_days: number;
  aging_bucket: string;
  payment_status: SalePaymentStatus;
}

export interface RevenueCollectionRow {
  collection_id: string;
  sale_id: string;
  occurred_at: string;
  amount: DecimalString;
  buyer_name: string;
  crop: string;
  season: string | null;
  collected_by: string | null;
  note: string | null;
  journal_entry_id: string | null;
}

export interface ExactRevenueReport {
  period_start: string;
  period_end: string;
  as_of: string;
  finalized_revenue: DecimalString;
  period_collections: DecimalString;
  outstanding_total: DecimalString;
  over_30_amount: DecimalString;
  over_30_count: number;
  pending_count: number;
  pending_qty: DecimalString;
  sales: RevenueSaleRow[];
  by_buyer: RevenueBuyerRow[];
  by_crop_season: RevenueCropRow[];
  ar_rows: RevenueArRow[];
  collections: RevenueCollectionRow[];
}

export interface ExactRevenueChartInput {
  label: string;
  finalizedRevenue: DecimalString;
  outstanding: DecimalString;
}

export type ExactRevenueChartRow = Record<string, string | number>;

/** Never draw a partial chart: one unsafe decimal degrades the whole dimension explicitly. */
export function exactRevenueChartRows(
  rows: ExactRevenueChartInput[],
): ExactRevenueChartRow[] | null {
  const converted = rows.map((row) => ({
    label: row.label,
    revenue: decimalToSafeNumber(row.finalizedRevenue),
    outstanding: decimalToSafeNumber(row.outstanding),
  }));
  if (converted.some((row) => row.revenue == null || row.outstanding == null)) return null;
  return converted.map((row) => ({
    label: row.label,
    "إيراد مسعّر": row.revenue as number,
    "ذمم قائمة": row.outstanding as number,
  }));
}

type Row = Record<string, unknown>;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_STATUSES = new Set<SalePaymentStatus>([
  "unpaid",
  "partially_collected",
  "collected",
  "historical_treasury",
  "historical_reversed",
]);

function row(value: unknown, label: string): Row {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Row;
}

function rows(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value.map((item, index) => row(item, `${label} row ${index + 1}`));
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is invalid`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function date(value: unknown, label: string): string {
  const result = text(value, label);
  if (!DATE_RE.test(result)) throw new Error(`${label} is not a date`);
  return result;
}

function nullableDate(value: unknown, label: string): string | null {
  return value === null ? null : date(value, label);
}

function decimal(value: unknown, label: string): DecimalString {
  if (typeof value !== "string") throw new Error(`${label} is not exact text`);
  const result = parseDecimal(value);
  if (result == null) throw new Error(`${label} is invalid`);
  return result;
}

function nullableDecimal(value: unknown, label: string): DecimalString | null {
  return value === null ? null : decimal(value, label);
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a safe count`);
  }
  return value;
}

function paymentStatus(value: unknown, label: string): SalePaymentStatus {
  if (typeof value !== "string" || !PAYMENT_STATUSES.has(value as SalePaymentStatus)) {
    throw new Error(`${label} is invalid`);
  }
  return value as SalePaymentStatus;
}

export function parseExactRevenueReport(value: unknown): ExactRevenueReport {
  const report = row(value, "revenue report");
  return {
    period_start: date(report.period_start, "period_start"),
    period_end: date(report.period_end, "period_end"),
    as_of: date(report.as_of, "as_of"),
    finalized_revenue: decimal(report.finalized_revenue, "finalized_revenue"),
    period_collections: decimal(report.period_collections, "period_collections"),
    outstanding_total: decimal(report.outstanding_total, "outstanding_total"),
    over_30_amount: decimal(report.over_30_amount, "over_30_amount"),
    over_30_count: count(report.over_30_count, "over_30_count"),
    pending_count: count(report.pending_count, "pending_count"),
    pending_qty: decimal(report.pending_qty, "pending_qty"),
    sales: rows(report.sales, "sales").map(parseSale),
    by_buyer: rows(report.by_buyer, "by_buyer").map(parseBuyer),
    by_crop_season: rows(report.by_crop_season, "by_crop_season").map(parseCrop),
    ar_rows: rows(report.ar_rows, "ar_rows").map(parseAr),
    collections: rows(report.collections, "collections").map(parseCollection),
  };
}

function parseSale(item: Row, index: number): RevenueSaleRow {
  const label = `sales row ${index + 1}`;
  const priceStatus = text(item.price_status, `${label} price_status`);
  if (priceStatus !== "pending" && priceStatus !== "finalized") {
    throw new Error(`${label} price_status is invalid`);
  }
  return {
    sale_id: text(item.sale_id, `${label} sale_id`),
    report_date: date(item.report_date, `${label} report_date`),
    sale_date: nullableDate(item.sale_date, `${label} sale_date`),
    delivery_date: nullableDate(item.delivery_date, `${label} delivery_date`),
    crop: text(item.crop, `${label} crop`),
    season: nullableText(item.season, `${label} season`),
    qty: nullableDecimal(item.qty, `${label} qty`),
    unit: nullableText(item.unit, `${label} unit`),
    unit_price: nullableDecimal(item.unit_price, `${label} unit_price`),
    total: nullableDecimal(item.total, `${label} total`),
    price_status: priceStatus,
    payment_status: paymentStatus(item.payment_status, `${label} payment_status`),
    buyer_id: nullableText(item.buyer_id, `${label} buyer_id`),
    buyer_name: nullableText(item.buyer_name, `${label} buyer_name`),
    buyer_type: nullableText(item.buyer_type, `${label} buyer_type`),
    cost_center_id: nullableText(item.cost_center_id, `${label} cost_center_id`),
    cost_center_code: nullableText(item.cost_center_code, `${label} cost_center_code`),
    cost_center_name: nullableText(item.cost_center_name, `${label} cost_center_name`),
    farm_name: nullableText(item.farm_name, `${label} farm_name`),
    sector_name: nullableText(item.sector_name, `${label} sector_name`),
    hawsha_name: nullableText(item.hawsha_name, `${label} hawsha_name`),
    collected_to_as_of: decimal(item.collected_to_as_of, `${label} collected_to_as_of`),
    collected_in_period: decimal(item.collected_in_period, `${label} collected_in_period`),
    outstanding: nullableDecimal(item.outstanding, `${label} outstanding`),
  };
}

function parseBuyer(item: Row, index: number): RevenueBuyerRow {
  const label = `by_buyer row ${index + 1}`;
  return {
    buyer_id: nullableText(item.buyer_id, `${label} buyer_id`),
    buyer_name: text(item.buyer_name, `${label} buyer_name`),
    buyer_type: nullableText(item.buyer_type, `${label} buyer_type`),
    sale_count: count(item.sale_count, `${label} sale_count`),
    pending_count: count(item.pending_count, `${label} pending_count`),
    qty: decimal(item.qty, `${label} qty`),
    finalized_revenue: decimal(item.finalized_revenue, `${label} finalized_revenue`),
    collected_in_period: decimal(item.collected_in_period, `${label} collected_in_period`),
    collected_to_as_of: decimal(item.collected_to_as_of, `${label} collected_to_as_of`),
    outstanding: decimal(item.outstanding, `${label} outstanding`),
  };
}

function parseCrop(item: Row, index: number): RevenueCropRow {
  const label = `by_crop_season row ${index + 1}`;
  return {
    crop: text(item.crop, `${label} crop`),
    season: text(item.season, `${label} season`),
    sale_count: count(item.sale_count, `${label} sale_count`),
    pending_count: count(item.pending_count, `${label} pending_count`),
    qty: decimal(item.qty, `${label} qty`),
    finalized_revenue: decimal(item.finalized_revenue, `${label} finalized_revenue`),
    collected_in_period: decimal(item.collected_in_period, `${label} collected_in_period`),
    outstanding: decimal(item.outstanding, `${label} outstanding`),
  };
}

function parseAr(item: Row, index: number): RevenueArRow {
  const label = `ar_rows row ${index + 1}`;
  return {
    sale_id: text(item.sale_id, `${label} sale_id`),
    report_date: date(item.report_date, `${label} report_date`),
    buyer_id: nullableText(item.buyer_id, `${label} buyer_id`),
    buyer_name: nullableText(item.buyer_name, `${label} buyer_name`),
    buyer_type: nullableText(item.buyer_type, `${label} buyer_type`),
    crop: text(item.crop, `${label} crop`),
    season: nullableText(item.season, `${label} season`),
    total: decimal(item.total, `${label} total`),
    collected_to_as_of: decimal(item.collected_to_as_of, `${label} collected_to_as_of`),
    outstanding: decimal(item.outstanding, `${label} outstanding`),
    age_days: count(item.age_days, `${label} age_days`),
    aging_bucket: text(item.aging_bucket, `${label} aging_bucket`),
    payment_status: paymentStatus(item.payment_status, `${label} payment_status`),
  };
}

function parseCollection(item: Row, index: number): RevenueCollectionRow {
  const label = `collections row ${index + 1}`;
  return {
    collection_id: text(item.collection_id, `${label} collection_id`),
    sale_id: text(item.sale_id, `${label} sale_id`),
    occurred_at: date(item.occurred_at, `${label} occurred_at`),
    amount: decimal(item.amount, `${label} amount`),
    buyer_name: text(item.buyer_name, `${label} buyer_name`),
    crop: text(item.crop, `${label} crop`),
    season: nullableText(item.season, `${label} season`),
    collected_by: nullableText(item.collected_by, `${label} collected_by`),
    note: nullableText(item.note, `${label} note`),
    journal_entry_id: nullableText(item.journal_entry_id, `${label} journal_entry_id`),
  };
}
