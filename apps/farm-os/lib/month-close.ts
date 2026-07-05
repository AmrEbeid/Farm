export type CloseSaleRow = {
  id: string;
  total?: number | string | null;
  sale_date?: string | null;
  delivery_date?: string | null;
  created_at?: string | null;
};

export type SaleCollectionRow = {
  sale_id: string;
  amount?: number | string | null;
};

export function saleReportDate(sale: CloseSaleRow): string {
  return sale.sale_date ?? sale.delivery_date ?? String(sale.created_at ?? "").slice(0, 10);
}

export function isSaleOnOrAfterReportDate(sale: CloseSaleRow, startDate: string): boolean {
  return saleReportDate(sale) >= startDate;
}

export function summarizeAgedReceivables(
  sales: readonly CloseSaleRow[],
  collections: readonly SaleCollectionRow[],
  cutoffDate: string,
  startDate?: string,
): { count: number; amount: number } {
  const collectedBySale = new Map<string, number>();
  for (const collection of collections) {
    collectedBySale.set(
      collection.sale_id,
      (collectedBySale.get(collection.sale_id) ?? 0) + Number(collection.amount ?? 0),
    );
  }

  let count = 0;
  let amount = 0;
  for (const sale of sales) {
    const reportDate = saleReportDate(sale);
    if (startDate && reportDate < startDate) continue;
    if (reportDate > cutoffDate) continue;
    const outstanding = Math.max(0, Number(sale.total ?? 0) - (collectedBySale.get(sale.id) ?? 0));
    amount += outstanding;
    if (outstanding > 0) count += 1;
  }

  return { count, amount };
}
