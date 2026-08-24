import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(
  new URL("../app/(app)/finance/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const lazyCharts = readFileSync(
  new URL("../components/LazyFinanceDashboardBudgetCharts.tsx", import.meta.url),
  "utf8",
);
const charts = readFileSync(
  new URL("../components/FinanceDashboardBudgetCharts.tsx", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("finance dashboard chart loading", () => {
  it("keeps Recharts out of the server dashboard module", () => {
    expect(dashboard).toContain("LazyFinanceDashboardBudgetCharts");
    expect(dashboard).not.toContain('from "@/components/charts"');
    expect(dashboard).not.toContain('from "@/components/charts-client"');
  });

  it("loads the chart bundle only as the chart region approaches the viewport", () => {
    expect(lazyCharts).toContain('lazy(');
    expect(lazyCharts).toContain('import("@/components/FinanceDashboardBudgetCharts")');
    expect(lazyCharts).toContain('<Suspense fallback=');
    expect(lazyCharts).toContain('new IntersectionObserver(');
    expect(lazyCharts).toContain('rootMargin: "300px"');
  });

  it("keeps the proven chart implementation behind the lazy boundary", () => {
    expect(charts).toContain('from "@/components/charts-client"');
    expect(charts).toContain("<BudgetDoughnut");
    expect(charts).toContain("<VarianceChart");
  });

  it("keeps exact accessible and printable data while the chart bundle is deferred", () => {
    expect(dashboard).toContain("usedLabel={egpExact(spentOrCommitted)}");
    expect(dashboard).toContain('availableLabel={egpExact(maxDecimal(available, "0"))}');
    expect(dashboard).toContain("plannedLabel: egpExact(category.approved)");
    expect(dashboard).toContain("actualLabel: egpExact(actualExact)");
    expect(lazyCharts).toContain("finance-lazy-chart__fallback");
    expect(lazyCharts).toContain("<ChartPlaceholder height={240}>");
    expect(lazyCharts).toContain("<ChartPlaceholder height={260}>");
    expect(globalCss).toContain(".finance-lazy-chart__placeholder .fos-chart__canvas");
    expect(globalCss).toContain(".finance-lazy-chart__fallback");
  });
});
