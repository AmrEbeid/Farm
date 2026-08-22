import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pages = [
  "app/(app)/finance/enterprise-scorecard/page.tsx",
  "app/(app)/finance/insights/page.tsx",
  "app/(app)/finance/insights-summary/page.tsx",
  "app/(app)/finance/sector-scorecard/page.tsx",
  "app/(app)/insights/annual-report/page.tsx",
  "app/(app)/insights/benchmark/page.tsx",
];

describe("exact cost-center revenue consumers", () => {
  for (const path of pages) {
    it(`${path} uses the exact aggregate and validates it before rendering`, () => {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source.match(/\.rpc\("fn_cost_center_revenue_summary"/g)).toHaveLength(1);
      expect(source).toContain("parseCostCenterRevenueSummary(");
      expect(source).not.toContain('.select("id, cost_center_id, total, price_status")');
      expect(source).not.toContain('.select("cost_center_id, total, price_status")');
      expect(source).not.toMatch(/\.from\("journal_entries"\).*source_type.*sale/);
    });
  }
});
