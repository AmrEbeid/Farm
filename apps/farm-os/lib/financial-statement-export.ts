import type { SimpleRow } from "@/components/SimpleTable";
import type { BalanceSheetLine } from "@/lib/balance-sheet";
import type { IncomeStatementLine } from "@/lib/income-statement";

export function balanceSheetExportRows(lines: readonly BalanceSheetLine[]): SimpleRow[] {
  return lines.map((line, index) => ({
    id: `${line.code}-${index}`,
    code: line.code,
    name_ar: line.nameAr,
    balance: line.balance,
  }));
}

export function incomeStatementExportRows(lines: readonly IncomeStatementLine[]): SimpleRow[] {
  return lines.map((line, index) => ({
    id: `${line.code}-${index}`,
    code: line.code,
    name_ar: line.nameAr,
    amount: line.amount,
  }));
}
