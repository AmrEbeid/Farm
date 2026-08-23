import {
  type CustodyDailyAccount,
  type CustodyDailyRequest,
  type CustodyRequestFilter,
} from "./custody-daily-snapshot";
import {
  compareDecimals,
  maxDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "./decimal";
import { fmtDate } from "./dates";
import { num } from "./money";

export const CUSTODY_PATH = "/custody";
export const CUSTODY_QUERY_MAX_LENGTH = 60;

export interface CustodyListContext {
  requestFilter: CustodyRequestFilter;
  query: string;
}

function parseRequestFilter(raw: string | undefined): CustodyRequestFilter {
  return raw === "awaiting" || raw === "settled" ? raw : "all";
}

function parseQuery(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  let cleaned = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    cleaned += code <= 0x1f || code === 0x7f ? " " : raw[index];
  }
  return cleaned.trim().slice(0, CUSTODY_QUERY_MAX_LENGTH).trim();
}

export function parseCustodyListContext(params: { requests?: string; q?: string }): CustodyListContext {
  return {
    requestFilter: parseRequestFilter(params.requests),
    query: parseQuery(params.q),
  };
}

export function custodyListHref(context: Partial<CustodyListContext> = {}): string {
  const search = new URLSearchParams();
  if (context.query) search.set("q", context.query);
  if (context.requestFilter && context.requestFilter !== "all") {
    search.set("requests", context.requestFilter);
  }
  const suffix = search.toString();
  return suffix ? `${CUSTODY_PATH}?${suffix}` : CUSTODY_PATH;
}

export function custodyRequestSearchMatches(
  request: CustodyDailyRequest,
  statusLabel: string,
  query: string,
): boolean {
  if (!query) return true;
  const normalized = query.toLocaleLowerCase("ar");
  return [
    String(request.requestNo),
    num(request.requestNo),
    statusLabel,
    request.periodStart,
    request.periodStart ? fmtDate(request.periodStart) : null,
    request.periodEnd,
    request.periodEnd ? fmtDate(request.periodEnd) : null,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase("ar").includes(normalized));
}

export function custodyAccountSummary(accounts: CustodyDailyAccount[]): {
  activeAccounts: CustodyDailyAccount[];
  topUps: DecimalString[];
  totalBalance: DecimalString;
  totalTarget: DecimalString;
  totalTopUp: DecimalString;
  inactiveCashCount: number;
} {
  const activeAccounts = accounts.filter((account) => account.active);
  const topUps = accounts.map((account) => account.active
    ? maxDecimal(subtractDecimals(account.targetFloat, account.balance), "0")
    : "0" as DecimalString);
  return {
    activeAccounts,
    topUps,
    totalBalance: sumDecimals(accounts.map((account) => account.balance)).total,
    totalTarget: sumDecimals(activeAccounts.map((account) => account.targetFloat)).total,
    totalTopUp: sumDecimals(topUps).total,
    inactiveCashCount: accounts.filter((account) => !account.active && compareDecimals(account.balance, "0") !== 0).length,
  };
}

export function custodyRequestWorkCounts(input: {
  all: number;
  awaiting: number;
  settled: number;
}): { draft: number; work: number } {
  const draft = Math.max(0, input.all - input.awaiting - input.settled);
  return { draft, work: draft + input.awaiting };
}

export function custodyMovementState(input: {
  movementType: string;
  reversalOf: string | null;
  reversedBy: string | null;
}): { label: string; status: "done" | "warning" | "blocked" } {
  if (input.reversalOf) return { label: `عكس — ${input.movementType}`, status: "warning" };
  if (input.reversedBy) return { label: `${input.movementType} — تم عكسها`, status: "blocked" };
  return { label: input.movementType, status: "done" };
}
