const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type FinanceReportDateParam = string | string[] | undefined;

interface FinanceReportDateRange {
  start: string;
  end: string;
}

export function isIsoCalendarDate(value: FinanceReportDateParam): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(ISO_DATE);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function legacyPnlRedirectHref({
  from,
  to,
}: {
  from?: string | string[];
  to?: string | string[];
}): string {
  if (isIsoCalendarDate(from) && isIsoCalendarDate(to) && from > to) {
    return "/finance/income-statement";
  }
  const query = new URLSearchParams();
  if (isIsoCalendarDate(from)) query.set("start", from);
  if (isIsoCalendarDate(to)) query.set("end", to);
  const encoded = query.toString();
  return encoded ? `/finance/income-statement?${encoded}` : "/finance/income-statement";
}

export function normalizeFinanceReportDateRange({
  start,
  end,
  fallbackStart,
  fallbackEnd,
}: {
  start: FinanceReportDateParam;
  end: FinanceReportDateParam;
  fallbackStart: string;
  fallbackEnd: string;
}): FinanceReportDateRange {
  const normalizedStart = isIsoCalendarDate(start) ? start : fallbackStart;
  const normalizedEnd = isIsoCalendarDate(end) ? end : fallbackEnd;
  return normalizedStart <= normalizedEnd
    ? { start: normalizedStart, end: normalizedEnd }
    : { start: fallbackStart, end: fallbackEnd };
}

export function legacyPnlTrendRedirectHref(grain: string | string[] | undefined): string {
  const normalizedGrain = grain === "year" ? "year" : "month";
  return `/finance/income-statement?view=trend&grain=${normalizedGrain}`;
}
