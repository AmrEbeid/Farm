// SPEC-0032 marketing workspace — the daily sales report ("تقرير المبيعات اليومي"), transcribed
// EXACTLY from the owner-supplied source HTML's own `computeDailyReport()` / `calcDailyReport()` /
// `addDailyReport()` functions (تسويق 2026 عبيد للتمور.html, lines 1660-1715 and 2579-2835). Never
// executed — only the reviewed algebra is reimplemented here, oracle-tested against hand-computed
// values (see daily-sales-report.test.ts) so it can't silently drift from the source.
//
// Source algebra (verbatim):
//   qty = sum(line.qty); total = sum(line.qty*line.price); expenses = sum(expenseItem.amount)
//   netAfterExpenses = total - expenses
//   avgPriceGross = qty ? total/qty : 0
//   avgPriceNet   = qty ? netAfterExpenses/qty : 0
//   avgCostPerKg  = qty ? expenses/qty : 0
//   // every sale line takes its OWN value at its OWN price, and its share of expenses strictly by
//   // its OWN qty (never by its share of revenue — a common invented-formula mistake):
//   sector.revenueShare = line.qty*line.price
//   sector.expenseShare = line.qty*avgCostPerKg
//   sector.netShare     = revenueShare-expenseShare
import type { Json } from "@/lib/database.types.ext";

/** Source `<input id="dsrSeller" value="...">` — the one default the source itself provides. */
export const DAILY_SALES_REPORT_DEFAULT_SELLER = "م/ عبدالجليل عبيد";

/** Source `<datalist id="dsrChannelList">` options, transcribed verbatim. */
export const DAILY_SALES_REPORT_CHANNEL_OPTIONS = [
  "تصدير",
  "محلي - جملة",
  "محلي - تجزئة",
  "سوق العبور",
  "أخرى",
] as const;

/** Source `channel=dsrVal('dsrLineChannel')||'بيع'` — the fallback channel label when left blank. */
export const DAILY_SALES_REPORT_DEFAULT_CHANNEL = "بيع";

export const DSR_MAX_LINES = 100;
export const DSR_MAX_EXPENSE_ITEMS = 100;
export const DSR_MAX_TEXT_LENGTH = 120;
export const DSR_MAX_NOTES_LENGTH = 2000;

export interface DailySalesLineInput {
  sector: string;
  channel: string;
  qtyKg: number;
  pricePerKg: number;
}

export interface DailyExpenseItemInput {
  name: string;
  amount: number;
}

export interface DailySalesSectorBreakdown {
  name: string;
  channel: string;
  qtyKg: number;
  pricePerKg: number;
  revenueShare: number;
  expenseShare: number;
  netShare: number;
}

export interface DailySalesReportResult {
  qtyKg: number;
  totalRevenue: number;
  totalExpenses: number;
  netAfterExpenses: number;
  avgPriceGross: number;
  avgPriceNet: number;
  avgCostPerKg: number;
  sectors: DailySalesSectorBreakdown[];
}

/** Rejects a line with no sector, or a non-finite/zero/negative qty or price — source's
 *  `if(!sector||!qty||!price)return alert(...)` guard, made explicit instead of an alert. */
export function isValidSalesLine(line: DailySalesLineInput): boolean {
  return (
    typeof line.sector === "string" &&
    line.sector.trim() !== "" &&
    line.sector.trim().length <= DSR_MAX_TEXT_LENGTH &&
    Number.isFinite(line.qtyKg) &&
    line.qtyKg > 0 &&
    Number.isFinite(line.pricePerKg) &&
    line.pricePerKg > 0
  );
}

/** Source's `if(!name||!amount)return alert(...)` guard for an expense item. */
export function isValidExpenseItem(item: DailyExpenseItemInput): boolean {
  return (
    typeof item.name === "string" &&
    item.name.trim() !== "" &&
    item.name.trim().length <= DSR_MAX_TEXT_LENGTH &&
    Number.isFinite(item.amount) &&
    item.amount > 0
  );
}

export function totalLineQty(lines: readonly DailySalesLineInput[]): number {
  return lines.reduce((sum, line) => sum + (line.qtyKg || 0), 0);
}

export function totalLineRevenue(lines: readonly DailySalesLineInput[]): number {
  return lines.reduce((sum, line) => sum + (line.qtyKg || 0) * (line.pricePerKg || 0), 0);
}

export function totalExpenseAmount(items: readonly DailyExpenseItemInput[]): number {
  return items.reduce((sum, item) => sum + (item.amount || 0), 0);
}

/** Source `computeDailyReport()`. */
export function computeDailySalesReport(
  lines: readonly DailySalesLineInput[],
  expenseItems: readonly DailyExpenseItemInput[],
): DailySalesReportResult {
  const qtyKg = totalLineQty(lines);
  const totalRevenue = totalLineRevenue(lines);
  const totalExpenses = totalExpenseAmount(expenseItems);
  const netAfterExpenses = totalRevenue - totalExpenses;
  const avgPriceGross = qtyKg ? totalRevenue / qtyKg : 0;
  const avgPriceNet = qtyKg ? netAfterExpenses / qtyKg : 0;
  const avgCostPerKg = qtyKg ? totalExpenses / qtyKg : 0;

  const sectors: DailySalesSectorBreakdown[] = lines.map((line) => {
    const revenueShare = line.qtyKg * line.pricePerKg;
    const expenseShare = line.qtyKg * avgCostPerKg;
    return {
      name: line.sector,
      channel: line.channel || DAILY_SALES_REPORT_DEFAULT_CHANNEL,
      qtyKg: line.qtyKg,
      pricePerKg: line.pricePerKg,
      revenueShare,
      expenseShare,
      netShare: revenueShare - expenseShare,
    };
  });

  return { qtyKg, totalRevenue, totalExpenses, netAfterExpenses, avgPriceGross, avgPriceNet, avgCostPerKg, sectors };
}

/** Source's message header — `تقرير مبيعات يوم ${date||'-'} — مزرعة عُبيد` uses the field title only. */
export function dailySalesReportTitle(date: string): string {
  return `تقرير مبيعات يوم ${date || "بدون تاريخ"}`;
}

function lineToJson(line: DailySalesLineInput): Record<string, Json> {
  return {
    sector: line.sector,
    channel: line.channel || DAILY_SALES_REPORT_DEFAULT_CHANNEL,
    qtyKg: line.qtyKg,
    pricePerKg: line.pricePerKg,
  };
}

function expenseToJson(item: DailyExpenseItemInput): Record<string, Json> {
  return { name: item.name, amount: item.amount };
}

function sectorToJson(sector: DailySalesSectorBreakdown): Record<string, Json> {
  return {
    name: sector.name,
    channel: sector.channel,
    qtyKg: sector.qtyKg,
    pricePerKg: sector.pricePerKg,
    revenueShare: sector.revenueShare,
    expenseShare: sector.expenseShare,
    netShare: sector.netShare,
  };
}

/**
 * Builds the `marketing_record.payload` for `recordType: "daily_sales_report"` — `result` must be
 * the `computeDailySalesReport()` output for the same `lines`/`expenseItems` (the caller already has
 * it for display, so this never recomputes it, keeping one source of truth per save).
 */
export function buildDailySalesReportPayload(input: {
  date: string;
  seller: string;
  buyer: string;
  witnesses: string;
  notes: string;
  lines: readonly DailySalesLineInput[];
  expenseItems: readonly DailyExpenseItemInput[];
  result: DailySalesReportResult;
}): Record<string, Json> {
  return {
    date: input.date,
    seller: input.seller,
    buyer: input.buyer,
    witnesses: input.witnesses,
    notes: input.notes,
    lines: input.lines.map(lineToJson),
    expenseItems: input.expenseItems.map(expenseToJson),
    sectors: input.result.sectors.map(sectorToJson),
    qtyKg: input.result.qtyKg,
    totalRevenue: input.result.totalRevenue,
    totalExpenses: input.result.totalExpenses,
    netAfterExpenses: input.result.netAfterExpenses,
    avgPriceGross: input.result.avgPriceGross,
    avgPriceNet: input.result.avgPriceNet,
    avgCostPerKg: input.result.avgCostPerKg,
  };
}

export interface DailySalesReportRecord {
  date: string;
  seller: string;
  buyer: string;
  witnesses: string;
  notes: string;
  lines: DailySalesLineInput[];
  expenseItems: DailyExpenseItemInput[];
  sectors: DailySalesSectorBreakdown[];
  qtyKg: number;
  totalRevenue: number;
  totalExpenses: number;
  netAfterExpenses: number;
  avgPriceGross: number;
  avgPriceNet: number;
  avgCostPerKg: number;
}

export interface DailySalesSectorLedgerRow {
  name: string;
  days: number;
  qtyKg: number;
  revenue: number;
  expenses: number;
  net: number;
  avgPrice: number;
}

/** Source `sectorLedger()` — aggregate every saved report line by sector, highest revenue first. */
export function buildDailySalesSectorLedger(
  reports: readonly Pick<DailySalesReportRecord, "date" | "sectors">[],
): DailySalesSectorLedgerRow[] {
  const ledger = new Map<string, {
    qtyKg: number;
    revenue: number;
    expenses: number;
    net: number;
    days: Set<string>;
  }>();
  for (const report of reports) {
    for (const sector of report.sectors) {
      const name = sector.name || "(بدون اسم)";
      const row = ledger.get(name) ?? { qtyKg: 0, revenue: 0, expenses: 0, net: 0, days: new Set<string>() };
      row.qtyKg += sector.qtyKg;
      row.revenue += sector.revenueShare;
      row.expenses += sector.expenseShare;
      row.net += sector.netShare;
      row.days.add(report.date);
      ledger.set(name, row);
    }
  }
  return [...ledger.entries()]
    .map(([name, row]) => ({
      name,
      days: row.days.size,
      qtyKg: row.qtyKg,
      revenue: row.revenue,
      expenses: row.expenses,
      net: row.net,
      avgPrice: row.qtyKg ? row.revenue / row.qtyKg : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function asString(value: Json | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asObject(value: Json | undefined): { [key: string]: Json | undefined } | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function asLines(value: Json | undefined): DailySalesLineInput[] {
  if (!Array.isArray(value)) return [];
  const out: DailySalesLineInput[] = [];
  for (const item of value) {
    const obj = asObject(item);
    if (!obj) continue;
    out.push({
      sector: asString(obj.sector),
      channel: asString(obj.channel),
      qtyKg: asNumber(obj.qtyKg),
      pricePerKg: asNumber(obj.pricePerKg),
    });
  }
  return out;
}

function asExpenseItems(value: Json | undefined): DailyExpenseItemInput[] {
  if (!Array.isArray(value)) return [];
  const out: DailyExpenseItemInput[] = [];
  for (const item of value) {
    const obj = asObject(item);
    if (!obj) continue;
    out.push({ name: asString(obj.name), amount: asNumber(obj.amount) });
  }
  return out;
}

function asSectors(value: Json | undefined): DailySalesSectorBreakdown[] {
  if (!Array.isArray(value)) return [];
  const out: DailySalesSectorBreakdown[] = [];
  for (const item of value) {
    const obj = asObject(item);
    if (!obj) continue;
    out.push({
      name: asString(obj.name),
      channel: asString(obj.channel),
      qtyKg: asNumber(obj.qtyKg),
      pricePerKg: asNumber(obj.pricePerKg),
      revenueShare: asNumber(obj.revenueShare),
      expenseShare: asNumber(obj.expenseShare),
      netShare: asNumber(obj.netShare),
    });
  }
  return out;
}

/** Defensively reads a saved `marketing_record.payload` back into a typed report — never throws on
 *  a malformed/legacy row; missing fields fall back to empty/zero rather than fabricating data. */
export function readDailySalesReportPayload(payload: Record<string, Json>): DailySalesReportRecord {
  return {
    date: asString(payload.date),
    seller: asString(payload.seller),
    buyer: asString(payload.buyer),
    witnesses: asString(payload.witnesses),
    notes: asString(payload.notes),
    lines: asLines(payload.lines),
    expenseItems: asExpenseItems(payload.expenseItems),
    sectors: asSectors(payload.sectors),
    qtyKg: asNumber(payload.qtyKg),
    totalRevenue: asNumber(payload.totalRevenue),
    totalExpenses: asNumber(payload.totalExpenses),
    netAfterExpenses: asNumber(payload.netAfterExpenses),
    avgPriceGross: asNumber(payload.avgPriceGross),
    avgPriceNet: asNumber(payload.avgPriceNet),
    avgCostPerKg: asNumber(payload.avgCostPerKg),
  };
}
