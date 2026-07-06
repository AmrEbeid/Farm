export interface SaleBusinessDateRow {
  sale_date?: string | null;
  delivery_date?: string | null;
  created_at?: string | null;
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
