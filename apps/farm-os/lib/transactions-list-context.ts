import type { TransactionType } from "./transactions snapshot";

export const TRANSACTIONS_PATH = "/transactions";
export const TRANSACTION_QUERY_MAX_LENGTH = 60;

export interface TransactionsListContext {
  type: TransactionType | null;
  query: string;
}

interface TransactionReference {
  id: string;
  type: TransactionType;
  party_id: string | null;
}

interface TransactionState {
  type: TransactionType;
  event_date: string | null;
  amount: string | null;
  pending_price: boolean;
  party_id: string | null;
}

const TYPES = ["expense", "sale", "collection", "custody"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasUnsafePathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || value[index] === "\\") return true;
  }
  return false;
}

function parseQuery(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  let cleaned = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    cleaned += code <= 0x1f || code === 0x7f ? " " : raw[index];
  }
  return cleaned.trim().slice(0, TRANSACTION_QUERY_MAX_LENGTH).trim();
}

function parseType(raw: string | undefined): TransactionType | null {
  return (TYPES as readonly string[]).includes(raw ?? "") ? raw as TransactionType : null;
}

export function parseTransactionsListContext(params: { type?: string; q?: string }): TransactionsListContext {
  return { type: parseType(params.type), query: parseQuery(params.q) };
}

export function transactionsListHref(context: Partial<TransactionsListContext> = {}): string {
  const search = new URLSearchParams();
  if (context.query) search.set("q", parseQuery(context.query));
  if (context.type && parseType(context.type) === context.type) search.set("type", context.type);
  const suffix = search.toString();
  return suffix ? `${TRANSACTIONS_PATH}?${suffix}` : TRANSACTIONS_PATH;
}

export function parseTransactionsReturnTo(raw: string | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) return TRANSACTIONS_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return TRANSACTIONS_PATH;
  if (hasUnsafePathCharacter(raw)) return TRANSACTIONS_PATH;
  const hashAt = raw.indexOf("#");
  const withoutHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  if (path !== TRANSACTIONS_PATH) return TRANSACTIONS_PATH;
  const search = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
  const rawQuery = search.get("q") ?? "";
  if (rawQuery.length > TRANSACTION_QUERY_MAX_LENGTH) return TRANSACTIONS_PATH;
  return transactionsListHref(parseTransactionsListContext({
    q: rawQuery || undefined,
    type: search.get("type") ?? undefined,
  }));
}

export function transactionRowTarget(
  row: TransactionReference,
  context: TransactionsListContext,
): { href: string | null; reason: string | null } {
  const from = transactionsListHref(context);
  if (row.type === "expense") {
    if (!UUID.test(row.id)) return { href: null, reason: "مرجع المصروف غير صالح" };
    const search = new URLSearchParams([["from", from]]);
    return { href: `/expenses/${row.id}?${search.toString()}`, reason: null };
  }
  if (row.type === "custody") {
    return UUID.test(row.id)
      ? { href: `/custody/movements/${row.id}`, reason: null }
      : { href: null, reason: "مرجع حركة العهدة غير صالح" };
  }
  if (row.type === "sale") {
    return row.party_id && UUID.test(row.party_id)
      ? { href: `/finance/buyers/${row.party_id}`, reason: null }
      : { href: null, reason: "بيع بلا عميل مسجل — لا يوجد ملف عميل لفتحه" };
  }
  return { href: null, reason: "لا توجد صفحة تفصيل لهذا التحصيل بعد" };
}

export function transactionNextStep(row: TransactionState): { label: string; attention: boolean } {
  if (row.type === "expense") {
    if (row.amount === null) return { label: "المبلغ غير مسجل — أكمل بيانات المصروف", attention: true };
    if (row.event_date === null) return { label: "بدون تاريخ — أضف تاريخ المصروف", attention: true };
    return { label: "افتح ملف المصروف", attention: false };
  }
  if (row.type === "sale") {
    if (row.pending_price) return { label: "السعر معلّق — حدّده ليدخل الدفاتر", attention: true };
    if (row.event_date === null) return { label: "بدون تاريخ — راجع البيع", attention: true };
    if (row.party_id === null) return { label: "بيع بلا عميل مسجل — راجع البيع", attention: true };
    return { label: "افتح ملف العميل", attention: false };
  }
  if (row.type === "collection") {
    return row.event_date === null
      ? { label: "بدون تاريخ — راجع التحصيل في مصدره", attention: true }
      : { label: "تحصيل مسجل — لا توجد صفحة تفصيل بعد", attention: false };
  }
  return row.event_date === null
    ? { label: "بدون تاريخ — راجع حركة العهدة", attention: true }
    : { label: "افتح حركة العهدة", attention: false };
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ar")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٬,]/g, "")
    .replace(/٫/g, ".")
    .replace(/\.0+(?=\D|$)/g, "")
    .trim();
}

export function transactionSearchMatches(values: Array<string | null | undefined>, query: string): boolean {
  const needle = normalized(query);
  if (!needle) return true;
  return values.some((value) => typeof value === "string" && normalized(value).includes(needle));
}
