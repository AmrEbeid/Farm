import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const reports = read("app/(app)/finance/reports/page.tsx");
const center = read("app/(app)/finance/cost-centers/[id]/page.tsx");

describe("R4j cost-center reporting surfaces", () => {
  it("keeps the exact report snapshot and existing finance role gate", () => {
    expect(reports).toContain('requireRole(["owner", "accountant"])');
    expect(reports.split('sb.rpc("fn_cost_center_reports_snapshot"').length - 1).toBe(1);
    expect(reports).not.toContain('sb.from("journal_lines")');
    expect(reports).toContain("parseCostCenterReportsSnapshot(snapshotRes.data, m.orgId");
  });

  it("turns the report into a compact decision surface", () => {
    expect(reports).toContain('data-testid="cost-center-reports"');
    expect(reports).toContain("اقتصاديات مراكز التكلفة");
    expect(reports).toContain("أين تذهب الفلوس");
    expect(reports).toContain("الجدول الكامل والتصدير");
    expect(reports).toContain("<CenterRow");
    expect(reports).toContain("أرقامه تشمل التابع");
    expect(reports).toContain("costCenterHierarchyPresentation(rollup, row.costCenterId)");
    expect(reports).not.toContain("<KpiCard");
    expect(reports).not.toContain("<main");
    expect(reports).not.toMatch(/text-2xl|text-3xl/);
  });

  it("keeps the center detail totals separate from its bounded rows", () => {
    expect(center).toContain('sb.rpc("fn_cost_center_direct_summary"');
    expect(center).toContain(".limit(DIRECT_DISPLAY_CAP)");
    expect(center).toContain("isDirectTableTruncated(summary.expenseCount)");
    expect(center).toContain("isDirectTableTruncated(summary.saleCount)");
    expect(center).toContain("الإجمالي أعلاه");
    expect(center).toContain("saleExclusions.finalizedWithoutPostedJournal");
    expect(center).toContain("مسعرة بلا قيد مرحّل");
  });

  it("uses the shared 360 scaffold and explains direct versus subtree money", () => {
    expect(center).toContain('data-testid="cost-center-360"');
    expect(center).toContain("<Entity360Header");
    expect(center).toContain("<EntityTabs");
    expect(center).toContain('id={tabPanelId("overview")}');
    expect(center).toContain('id={tabPanelId("expenses")}');
    expect(center).toContain('id={tabPanelId("sales")}');
    expect(center).toContain('title="مباشر"');
    expect(center).toContain('title="الشجرة"');
    expect(center).not.toContain("<KpiCard");
    expect(center).not.toContain("<main");
    expect(center).not.toMatch(/text-2xl|text-3xl/);
  });
});
