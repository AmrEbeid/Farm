import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(__dirname, "../app/(app)/settings/analytics/page.tsx"), "utf8");
const nav = readFileSync(resolve(__dirname, "./nav.ts"), "utf8");
const analytics = readFileSync(resolve(__dirname, "./website-analytics.ts"), "utf8");

describe("website analytics settings surface", () => {
  it("is owner-only and appears under settings", () => {
    expect(page).toContain('requireRole(["owner"])');
    expect(nav).toContain('href: "/settings/analytics", roles: ["owner"]');
  });

  it("keeps the Vercel credential on the server and limits traffic to the public homepage", () => {
    expect(analytics).toContain("process.env.VERCEL_ANALYTICS_TOKEN");
    expect(analytics).toContain('filter: "requestPath eq \'/\'"');
    expect(page).not.toContain("VERCEL_ANALYTICS_TOKEN");
  });
});
