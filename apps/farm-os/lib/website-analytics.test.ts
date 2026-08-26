import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadWebsiteAnalytics } from "./website-analytics";

const config = { token: "test-token", projectId: "prj_test", teamId: "team_test" };

function response(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("website analytics read model", () => {
  it("stays unconfigured without exposing or guessing credentials", async () => {
    const snapshot = await loadWebsiteAnalytics("30d", {
      config: { token: "", projectId: "", teamId: "" },
      now: new Date("2026-08-25T00:00:00Z"),
    });
    expect(snapshot.status).toBe("unconfigured");
    expect(snapshot.visitors).toBe(0);
  });

  it("queries only the public homepage and maps aggregated analytics", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("by") === "day") {
        return response({ data: [{ timestamp: "2026-08-24T00:00:00.000Z", visitors: 4, pageviews: 6 }] });
      }
      if (url.searchParams.get("by") === "eventName") {
        return response({ data: [{ eventName: "contact_whatsapp", visitors: 2, count: 3 }] });
      }
      const dimension = url.searchParams.get("by") ?? "unknown";
      return response({ data: [{ [dimension]: "sample", visitors: 5, pageviews: 7 }] });
    });

    const snapshot = await loadWebsiteAnalytics("7d", {
      config,
      fetcher,
      now: new Date("2026-08-25T00:00:00Z"),
    });

    expect(snapshot).toMatchObject({
      status: "ready",
      visitors: 4,
      pageviews: 6,
      trend: [{ date: "2026-08-24", visitors: 4, pageviews: 6 }],
      events: [{ label: "contact_whatsapp", visitors: 2, pageviews: 0, count: 3 }],
    });
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (const [input, init] of fetcher.mock.calls) {
      const url = new URL(String(input));
      expect(url.pathname).not.toMatch(/\/visits\/count$/);
      expect(url.searchParams.get("filter")).toBe("requestPath eq '/'");
      expect(url.searchParams.get("projectId")).toBe("prj_test");
      expect(url.searchParams.get("teamId")).toBe("team_test");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      expect(String(input)).not.toContain("test-token");
    }
  });

  it("keeps KPI cards equal to the sum of the displayed daily graph rows", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("by") === "day") {
        return response({
          data: [
            { timestamp: "2026-08-24T00:00:00.000Z", visitors: "2", pageviews: "2" },
            { timestamp: "2026-08-25T00:00:00.000Z", visitors: "1", pageviews: "5" },
          ],
        });
      }
      return response({ data: [] });
    });

    const snapshot = await loadWebsiteAnalytics("7d", {
      config,
      fetcher,
      now: new Date("2026-08-25T12:00:00Z"),
    });

    expect(snapshot).toMatchObject({
      status: "ready",
      visitors: 3,
      pageviews: 7,
      trend: [
        { date: "2026-08-24", visitors: 2, pageviews: 2 },
        { date: "2026-08-25", visitors: 1, pageviews: 5 },
      ],
    });
  });

  it("keeps the cards at zero when the displayed trend has no rows", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: [] }));

    const snapshot = await loadWebsiteAnalytics("7d", {
      config,
      fetcher,
      now: new Date("2026-08-25T12:00:00Z"),
    });

    expect(snapshot).toMatchObject({
      status: "ready",
      visitors: 0,
      pageviews: 0,
      trend: [],
    });
  });

  it("ignores malformed dates and clamps invalid numeric trend values", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("by") === "day") {
        return response({
          data: [
            { timestamp: "not-a-date", visitors: 99, pageviews: 99 },
            { timestamp: "2026-08-25T00:00:00.000Z", visitors: -3, pageviews: 5 },
            { timestamp: "2026-08-24T00:00:00.000Z", visitors: 2, pageviews: Number.POSITIVE_INFINITY },
          ],
        });
      }
      return response({ data: [] });
    });

    const snapshot = await loadWebsiteAnalytics("7d", {
      config,
      fetcher,
      now: new Date("2026-08-25T12:00:00Z"),
    });

    expect(snapshot).toMatchObject({
      visitors: 2,
      pageviews: 5,
      trend: [
        { date: "2026-08-24", visitors: 2, pageviews: 0 },
        { date: "2026-08-25", visitors: 0, pageviews: 5 },
      ],
    });
  });

  it("fails closed with a friendly empty state when Vercel rejects the request", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("denied", { status: 403 }));
    const snapshot = await loadWebsiteAnalytics("90d", { config, fetcher });
    expect(snapshot.status).toBe("error");
    expect(snapshot.message).toContain("تعذّر تحميل التحليلات");
  });
});
