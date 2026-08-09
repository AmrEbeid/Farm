export interface SaleBusinessDateRow {
  sale_date?: string | null;
  delivery_date?: string | null;
  created_at?: string | null;
}

const CAIRO_CALENDAR_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function monthCloseDates(now: Date = new Date()): { monthStart: string; asOf: string } {
  const parts = CAIRO_CALENDAR_DAY.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("monthCloseDates: could not resolve the Cairo calendar day");
  }
  return { monthStart: `${year}-${month}-01`, asOf: `${year}-${month}-${day}` };
}

export function saleBusinessDate(sale: SaleBusinessDateRow): string | null {
  return sale.sale_date ?? sale.delivery_date ?? (sale.created_at ? String(sale.created_at).slice(0, 10) : null);
}

export function isSaleInLiveEra(sale: SaleBusinessDateRow, cutover: string): boolean {
  const reportDate = saleBusinessDate(sale);
  return reportDate != null && reportDate >= cutover;
}

export function isAgedLiveReceivable(sale: SaleBusinessDateRow, cutover: string, agedOnOrBefore: string): boolean {
  const reportDate = saleBusinessDate(sale);
  return reportDate != null && reportDate >= cutover && reportDate <= agedOnOrBefore;
}
