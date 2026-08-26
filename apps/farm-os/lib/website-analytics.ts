import "server-only";

export type WebsiteAnalyticsPeriod = "7d" | "30d" | "90d";

export interface WebsiteAnalyticsBreakdown {
  label: string;
  visitors: number;
  pageviews?: number;
  count?: number;
}

export interface WebsiteAnalyticsSnapshot {
  status: "ready" | "unconfigured" | "error";
  period: WebsiteAnalyticsPeriod;
  since: string;
  until: string;
  visitors: number;
  pageviews: number;
  trend: Array<{ date: string; visitors: number; pageviews: number }>;
  countries: WebsiteAnalyticsBreakdown[];
  referrers: WebsiteAnalyticsBreakdown[];
  devices: WebsiteAnalyticsBreakdown[];
  browsers: WebsiteAnalyticsBreakdown[];
  events: WebsiteAnalyticsBreakdown[];
  message?: string;
}

interface AnalyticsConfig {
  token?: string;
  projectId?: string;
  teamId?: string;
}

type AnalyticsRow = Record<string, unknown>;

const PERIOD_DAYS: Record<WebsiteAnalyticsPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function rows(value: unknown): AnalyticsRow[] {
  if (!value || typeof value !== "object") return [];
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data) ? data.filter((row): row is AnalyticsRow => !!row && typeof row === "object") : [];
}

function countRow(value: unknown): AnalyticsRow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = (value as { data?: unknown }).data;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? first as AnalyticsRow : undefined;
  }
  return data && typeof data === "object" ? data as AnalyticsRow : undefined;
}

function breakdown(value: unknown, dimension: string): WebsiteAnalyticsBreakdown[] {
  return rows(value).map((row) => ({
    label: typeof row[dimension] === "string" && row[dimension] ? row[dimension] : "غير محدد",
    visitors: numberValue(row.visitors),
    pageviews: numberValue(row.pageviews),
    count: numberValue(row.count),
  }));
}

function emptySnapshot(
  period: WebsiteAnalyticsPeriod,
  since: string,
  until: string,
  status: WebsiteAnalyticsSnapshot["status"],
  message: string,
): WebsiteAnalyticsSnapshot {
  return {
    status,
    period,
    since,
    until,
    visitors: 0,
    pageviews: 0,
    trend: [],
    countries: [],
    referrers: [],
    devices: [],
    browsers: [],
    events: [],
    message,
  };
}

async function query(
  path: string,
  params: Record<string, string>,
  config: Required<AnalyticsConfig>,
  fetcher: typeof fetch,
): Promise<unknown> {
  const url = new URL(`https://api.vercel.com/v1/query/web-analytics/${path}`);
  url.searchParams.set("projectId", config.projectId);
  url.searchParams.set("teamId", config.teamId);
  for (const [key, value] of Object.entries(params)) url.searchParams.append(key, value);

  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${config.token}` },
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error(`Vercel Analytics API returned ${response.status}`);
  return response.json();
}

export async function loadWebsiteAnalytics(
  period: WebsiteAnalyticsPeriod,
  options: {
    config?: AnalyticsConfig;
    fetcher?: typeof fetch;
    now?: Date;
  } = {},
): Promise<WebsiteAnalyticsSnapshot> {
  const now = options.now ?? new Date();
  const sinceDate = new Date(now);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - PERIOD_DAYS[period]);
  const since = sinceDate.toISOString();
  const until = now.toISOString();
  const config = {
    token: options.config?.token ?? process.env.VERCEL_ANALYTICS_TOKEN,
    projectId:
      options.config?.projectId ??
      process.env.VERCEL_ANALYTICS_PROJECT_ID ??
      process.env.VERCEL_PROJECT_ID,
    teamId:
      options.config?.teamId ??
      process.env.VERCEL_ANALYTICS_TEAM_ID ??
      process.env.VERCEL_TEAM_ID,
  };

  if (!config.token || !config.projectId || !config.teamId) {
    return emptySnapshot(
      period,
      since,
      until,
      "unconfigured",
      "يلزم ربط صلاحية قراءة تحليلات Vercel مرة واحدة.",
    );
  }

  const common = { since, until, filter: "requestPath eq '/'" };
  const fetcher = options.fetcher ?? fetch;
  try {
    const [counts, trend, countries, referrers, devices, browsers, events] = await Promise.all([
      query("visits/count", common, config as Required<AnalyticsConfig>, fetcher),
      query("visits/aggregate", { ...common, by: "day", limit: "100" }, config as Required<AnalyticsConfig>, fetcher),
      query("visits/aggregate", { ...common, by: "country", limit: "8" }, config as Required<AnalyticsConfig>, fetcher),
      query("visits/aggregate", { ...common, by: "referrerHostname", limit: "8" }, config as Required<AnalyticsConfig>, fetcher),
      query("visits/aggregate", { ...common, by: "deviceType", limit: "8" }, config as Required<AnalyticsConfig>, fetcher),
      query("visits/aggregate", { ...common, by: "browserName", limit: "8" }, config as Required<AnalyticsConfig>, fetcher),
      query("events/aggregate", { ...common, by: "eventName", limit: "20" }, config as Required<AnalyticsConfig>, fetcher),
    ]);
    const countData = countRow(counts);
    const trendData = rows(trend).map((row) => ({
      date: typeof row.timestamp === "string" ? row.timestamp.slice(0, 10) : "",
      visitors: numberValue(row.visitors),
      pageviews: numberValue(row.pageviews),
    }));
    const trendVisitors = trendData.reduce((total, point) => total + point.visitors, 0);
    const trendPageviews = trendData.reduce((total, point) => total + point.pageviews, 0);
    const countVisitors = numberValue(countData?.visitors);
    const countPageviews = numberValue(countData?.pageviews);
    const hasTrend = trendData.length > 0;

    return {
      status: "ready",
      period,
      since,
      until,
      visitors: hasTrend ? trendVisitors : countVisitors,
      pageviews: hasTrend ? trendPageviews : countPageviews,
      trend: trendData,
      countries: breakdown(countries, "country"),
      referrers: breakdown(referrers, "referrerHostname"),
      devices: breakdown(devices, "deviceType"),
      browsers: breakdown(browsers, "browserName"),
      events: breakdown(events, "eventName"),
    };
  } catch {
    return emptySnapshot(
      period,
      since,
      until,
      "error",
      "تعذّر تحميل التحليلات الآن. حاول مرة أخرى بعد قليل.",
    );
  }
}
