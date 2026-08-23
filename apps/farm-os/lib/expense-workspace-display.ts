export interface ExpenseWorkspaceSearchRow {
  date: string | null;
  category: string | null;
  description: string | null;
  supplier: string | null;
  account: string | null;
  accountId: string | null;
  kind: string;
  total: string | null;
  paymentStatus: string | null;
  costCenterId: string | null;
}

export function expenseNextStep(row: ExpenseWorkspaceSearchRow): { label: string; attention: boolean } {
  if (!row.date) return { label: "أضف التاريخ", attention: true };
  if (!row.accountId) return { label: "صنّف الحساب", attention: true };
  if (!row.costCenterId) return { label: "اربط مركز تكلفة", attention: true };
  if (!row.paymentStatus) return { label: "حدّد مسار السداد", attention: true };
  return { label: "راجع التفاصيل", attention: false };
}

export function expenseSearchMatches(row: ExpenseWorkspaceSearchRow, rawQuery: string): boolean {
  const normalize = (value: string) => value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٬,]/g, "")
    .replace(/٫/g, ".")
    .toLocaleLowerCase("ar");
  const query = normalize(rawQuery.trim());
  if (!query) return true;
  return [row.category, row.description, row.supplier, row.account, row.kind, row.total]
    .filter((value): value is string => typeof value === "string")
    .some((value) => normalize(value).includes(query));
}
