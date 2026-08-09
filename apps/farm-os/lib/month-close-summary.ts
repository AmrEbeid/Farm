import { parseDecimal, type DecimalString } from "./decimal";

export interface MonthCloseSummary {
  pendingPriceCount: number;
  undatedExpenseCount: number;
  undatedExpenseKnownTotal: DecimalString;
  undatedExpenseUnknownCount: number;
  unroutedCount: number;
  unroutedKnownTotal: DecimalString;
  unroutedUnknownCount: number;
  unclassifiedCount: number;
  unclassifiedKnownTotal: DecimalString;
  unclassifiedUnknownCount: number;
  unallocatedCount: number;
  unallocatedKnownTotal: DecimalString;
  unallocatedUnknownCount: number;
  agedReceivableCount: number;
  agedReceivableTotal: DecimalString;
}

export interface MonthCloseItem {
  key:
    | "pending_price"
    | "undated_expense"
    | "unrouted_expense"
    | "unclassified_expense"
    | "unallocated_expense"
    | "aged_receivable";
  label: string;
  count: number;
  amount?: DecimalString;
  unknownCount?: number;
  href: string;
  cta: string;
  tone: "act" | "watch";
  blocksClose: boolean;
}

export function buildMonthCloseItems(summary: MonthCloseSummary): MonthCloseItem[] {
  return [
    {
      key: "pending_price",
      label: "تسليمات بلا سعر",
      count: summary.pendingPriceCount,
      href: "/record/price",
      cta: "سعّرها",
      tone: "act",
      blocksClose: true,
    },
    {
      key: "undated_expense",
      label: "مصروفات بلا تاريخ",
      count: summary.undatedExpenseCount,
      amount: summary.undatedExpenseKnownTotal,
      unknownCount: summary.undatedExpenseUnknownCount,
      href: "/expenses?filter=undated",
      cta: "أكمل تاريخها",
      tone: "act",
      blocksClose: true,
    },
    {
      key: "unrouted_expense",
      label: "مصروفات بلا توجيه دفع (عهدة/آجل/مالك)",
      count: summary.unroutedCount,
      amount: summary.unroutedKnownTotal,
      unknownCount: summary.unroutedUnknownCount,
      href: "/expenses?filter=unrouted",
      cta: "وجّهها",
      tone: "act",
      blocksClose: true,
    },
    {
      key: "unclassified_expense",
      label: "مصروفات بلا حساب محاسبي",
      count: summary.unclassifiedCount,
      amount: summary.unclassifiedKnownTotal,
      unknownCount: summary.unclassifiedUnknownCount,
      href: "/expenses?filter=unclassified",
      cta: "صنّفها",
      tone: "watch",
      blocksClose: true,
    },
    {
      key: "unallocated_expense",
      label: "مصروفات بلا مركز تكلفة",
      count: summary.unallocatedCount,
      amount: summary.unallocatedKnownTotal,
      unknownCount: summary.unallocatedUnknownCount,
      href: "/expenses?filter=uncentered",
      cta: "وزّعها",
      tone: "watch",
      blocksClose: true,
    },
    {
      key: "aged_receivable",
      label: "ذمم عمرها ٣٠ يومًا فأكثر",
      count: summary.agedReceivableCount,
      amount: summary.agedReceivableTotal,
      href: "/record/collect",
      cta: "تابع التحصيل",
      tone: "watch",
      blocksClose: false,
    },
  ];
}

function requireMoney(row: Record<string, unknown>, key: string): DecimalString {
  const raw = row[key];
  const value = typeof raw === "string" ? parseDecimal(raw) : null;
  if (value == null || value.startsWith("-")) {
    throw new Error(`month close summary: field "${key}" must be non-negative decimal text`);
  }
  return value;
}

function requireCount(row: Record<string, unknown>, key: string): number {
  const raw = row[key];
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`month close summary: field "${key}" must be a safe integer`);
  }
  return value;
}

export function parseMonthCloseSummary(value: unknown): MonthCloseSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("month close summary: RPC returned no object payload");
  }
  const row = value as Record<string, unknown>;
  return {
    pendingPriceCount: requireCount(row, "pending_price_count"),
    undatedExpenseCount: requireCount(row, "undated_expense_count"),
    undatedExpenseKnownTotal: requireMoney(row, "undated_expense_known_total"),
    undatedExpenseUnknownCount: requireCount(row, "undated_expense_unknown_count"),
    unroutedCount: requireCount(row, "unrouted_count"),
    unroutedKnownTotal: requireMoney(row, "unrouted_known_total"),
    unroutedUnknownCount: requireCount(row, "unrouted_unknown_count"),
    unclassifiedCount: requireCount(row, "unclassified_count"),
    unclassifiedKnownTotal: requireMoney(row, "unclassified_known_total"),
    unclassifiedUnknownCount: requireCount(row, "unclassified_unknown_count"),
    unallocatedCount: requireCount(row, "unallocated_count"),
    unallocatedKnownTotal: requireMoney(row, "unallocated_known_total"),
    unallocatedUnknownCount: requireCount(row, "unallocated_unknown_count"),
    agedReceivableCount: requireCount(row, "aged_receivable_count"),
    agedReceivableTotal: requireMoney(row, "aged_receivable_total"),
  };
}
