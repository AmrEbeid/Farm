import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pages = [
  "app/(app)/dashboard/owner/page.tsx",
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

describe("owner dashboard read strategy", () => {
  it("loads attention counts in the first org-scoped batch and fails closed", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/dashboard/owner/page.tsx"),
      "utf8",
    );
    const firstBatchStart = source.indexOf("] = await Promise.all([");
    const firstBatchEnd = source.indexOf("]);", firstBatchStart);
    const firstBatch = source.slice(firstBatchStart, firstBatchEnd);
    const pendingPriceQuery = firstBatch.match(
      /sb\s*\.from\("sales"\)[\s\S]*?\.eq\("price_status", "pending"\),/,
    )?.[0];
    const unpaidExpenseQuery = firstBatch.match(
      /sb\s*\.from\("expenses"\)[\s\S]*?\.eq\("payment_status", "post_paid_unpaid"\),/,
    )?.[0];

    expect(firstBatchStart).toBeGreaterThan(-1);
    expect(firstBatchEnd).toBeGreaterThan(firstBatchStart);
    expect(pendingPriceQuery).toBeDefined();
    expect(pendingPriceQuery).toContain('.select("id", { count: "exact", head: true })');
    expect(pendingPriceQuery).toContain('.eq("org_id", m.orgId)');
    expect(pendingPriceQuery).toContain('.eq("price_status", "pending")');
    expect(unpaidExpenseQuery).toBeDefined();
    expect(unpaidExpenseQuery).toContain('.select("id", { count: "exact", head: true })');
    expect(unpaidExpenseQuery).toContain('.eq("org_id", m.orgId)');
    expect(unpaidExpenseQuery).toContain('.eq("payment_status", "post_paid_unpaid")');
    expect(source).toContain("pendingPriceError");
    expect(source).toContain("unpaidExpenseError");
    expect(source).toMatch(/for \(const e of \[[\s\S]*pendingPriceError[\s\S]*unpaidExpenseError[\s\S]*\]\)/);
  });
});
