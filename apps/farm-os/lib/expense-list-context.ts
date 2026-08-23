import { parseExpenseFilter, type ExpenseFilter } from "./expense-register-summary";

export const EXPENSES_PATH = "/expenses";
export const EXPENSE_QUERY_MAX_LENGTH = 60;
export const EXPENSE_TABS = ["overview", "links", "activity"] as const;

export type ExpenseTab = (typeof EXPENSE_TABS)[number];

export interface ExpenseListContext {
  filter: ExpenseFilter;
  query: string;
}

const EMPTY_CONTEXT: ExpenseListContext = { filter: "all", query: "" };

function hasUnsafePathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || value[index] === "\\") return true;
  }
  return false;
}

function parseExpenseQuery(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  let cleaned = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    cleaned += code <= 0x1f || code === 0x7f ? " " : raw[index];
  }
  return cleaned.trim().slice(0, EXPENSE_QUERY_MAX_LENGTH).trim();
}

export function parseExpenseListContext(params: { filter?: string; q?: string }): ExpenseListContext {
  return {
    filter: parseExpenseFilter(params.filter),
    query: parseExpenseQuery(params.q),
  };
}

export function expenseListHref(context: Partial<ExpenseListContext> = {}): string {
  const value = { ...EMPTY_CONTEXT, ...context };
  const search = new URLSearchParams();
  if (value.query) search.set("q", value.query);
  if (value.filter !== "all") search.set("filter", value.filter);
  const suffix = search.toString();
  return suffix ? `${EXPENSES_PATH}?${suffix}` : EXPENSES_PATH;
}

/** Rebuild one legal register return path. Caller-provided bytes are never echoed. */
export function parseExpenseReturnTo(raw: string | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return EXPENSES_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return EXPENSES_PATH;
  if (hasUnsafePathCharacter(raw)) return EXPENSES_PATH;

  const hashAt = raw.indexOf("#");
  const withoutHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  if (path !== EXPENSES_PATH) return EXPENSES_PATH;

  const search = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
  return expenseListHref(parseExpenseListContext({
    q: search.get("q") ?? undefined,
    filter: search.get("filter") ?? undefined,
  }));
}

export function parseExpenseTab(raw: string | undefined): ExpenseTab {
  return (EXPENSE_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as ExpenseTab)
    : "overview";
}

export function expenseHref(expenseId: string, tab: ExpenseTab, from: string | null): string {
  const search = new URLSearchParams();
  if (tab !== "overview") search.set("tab", tab);
  const safeFrom = from ? parseExpenseReturnTo(from) : EXPENSES_PATH;
  if (safeFrom !== EXPENSES_PATH) search.set("from", safeFrom);
  const suffix = search.toString();
  const base = `${EXPENSES_PATH}/${expenseId}`;
  return suffix ? `${base}?${suffix}` : base;
}

export function expenseHrefFromList(expenseId: string, context: ExpenseListContext): string {
  const from = expenseListHref(context);
  return expenseHref(expenseId, "overview", from === EXPENSES_PATH ? null : from);
}

export function expenseActionHref(
  expenseId: string,
  outcome: "ok" | "error",
  code: ExpenseNoticeCode,
  from: string | undefined,
): string {
  const search = new URLSearchParams([[outcome, code]]);
  const safeFrom = parseExpenseReturnTo(from);
  if (safeFrom !== EXPENSES_PATH) search.set("from", safeFrom);
  return `${EXPENSES_PATH}/${encodeURIComponent(expenseId)}?${search.toString()}`;
}

export type ExpenseNoticeCode =
  | "date_saved"
  | "invalid_date"
  | "locked_or_dated"
  | "date_save_failed";

const EXPENSE_NOTICE_AR: Record<ExpenseNoticeCode, string> = {
  date_saved: "تم حفظ تاريخ المصروف",
  invalid_date: "اختر تاريخًا صحيحًا",
  locked_or_dated: "لا يمكن وضع التاريخ داخل فترة محاسبية مقفلة، أو أن المصروف مؤرّخ بالفعل",
  date_save_failed: "تعذّر حفظ تاريخ المصروف",
};

export function expenseNotice(raw: string | undefined): string | null {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(EXPENSE_NOTICE_AR, raw)
    ? EXPENSE_NOTICE_AR[raw as ExpenseNoticeCode]
    : null;
}
