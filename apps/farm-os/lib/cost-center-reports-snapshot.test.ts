import { describe, expect, it } from "vitest";
import { parseCostCenterReportsSnapshot } from "./cost-center-reports-snapshot";

const ORG = "00000000-0000-0000-0000-000000000001";
const ROOT = "00000000-0000-0000-0000-000000000010";
const CHILD = "00000000-0000-0000-0000-000000000011";

function payload() {
  return {
    version: "farm-os.cost-center-reports.v1",
    org_id: ORG,
    history_included: true,
    rollup_count: 2,
    flag_count: 1,
    history_count: 1,
    unallocated_line_count: 3,
    expense_total: "100000000000000.01",
    revenue_total: "200000000000000.03",
    profit: "100000000000000.02",
    rollup: [
      {
        org_id: ORG,
        cost_center_id: ROOT,
        parent_id: null,
        code: "CC-ROOT",
        name_ar: "الجذر",
        sector_id: null,
        enterprise: null,
        area_feddan: "120.50",
        active: true,
        is_system: false,
        sort_order: -1,
        line_count: 4,
        expense: "100000000000000.01",
        revenue: "200000000000000.03",
        net: "100000000000000.02",
        net_per_feddan: "829875518672.1993360995850622",
      },
      {
        org_id: ORG,
        cost_center_id: CHILD,
        parent_id: ROOT,
        code: "CC-CHILD",
        name_ar: "الفرع",
        sector_id: null,
        enterprise: "نخيل",
        area_feddan: null,
        active: true,
        is_system: false,
        sort_order: null,
        line_count: 2,
        expense: "0.1",
        revenue: "0.02",
        net: "-0.08",
        net_per_feddan: null,
      },
    ],
    flags: [
      {
        org_id: ORG,
        cost_center_id: ROOT,
        code: "CC-ROOT",
        name_ar: "الجذر",
        flag_code: "missing_sector_link",
        message_ar: "مراجعة الربط",
      },
    ],
    history: [
      {
        year: 2025,
        account_id: "00000000-0000-0000-0000-000000000020",
        account_code: "5000",
        account_name_ar: "مصروف",
        account_type: "expense",
        cost_center_id: ROOT,
        center_code: "CC-ROOT",
        center_name_ar: "الجذر",
        amount: "100000000000000.01",
      },
    ],
  };
}

describe("parseCostCenterReportsSnapshot", () => {
  it("preserves exact money and validates the complete snapshot", () => {
    const parsed = parseCostCenterReportsSnapshot(payload(), ORG, true);
    expect(parsed.expenseTotal).toBe("100000000000000.01");
    expect(parsed.profit).toBe("100000000000000.02");
    expect(parsed.rollup[0].netPerFeddan).toBe("829875518672.1993360995850622");
    expect(parsed.rollup[0].sortOrder).toBe(-1);
    expect(parsed.history).toHaveLength(1);
  });

  it("accepts an overview only when history is explicitly absent", () => {
    const value = payload();
    value.history_included = false;
    value.history_count = 0;
    value.history = [];
    expect(parseCostCenterReportsSnapshot(value, ORG, false).history).toEqual([]);
  });

  it.each([
    ["organization", (value: ReturnType<typeof payload>) => { value.org_id = "foreign"; }],
    ["mode", (value: ReturnType<typeof payload>) => { value.history_included = false; }],
    ["rollup count", (value: ReturnType<typeof payload>) => { value.rollup_count = 1; }],
    ["flag count", (value: ReturnType<typeof payload>) => { value.flag_count = 0; }],
    ["history count", (value: ReturnType<typeof payload>) => { value.history_count = 0; }],
    ["profit", (value: ReturnType<typeof payload>) => { value.profit = "1"; }],
    ["numeric money", (value: ReturnType<typeof payload>) => { value.rollup[0].expense = 1 as unknown as string; }],
    ["negative line count", (value: ReturnType<typeof payload>) => { value.rollup[0].line_count = -1; }],
    ["row arithmetic", (value: ReturnType<typeof payload>) => { value.rollup[1].net = "0.07"; }],
    ["foreign row", (value: ReturnType<typeof payload>) => { value.rollup[0].org_id = "foreign"; }],
    ["missing parent", (value: ReturnType<typeof payload>) => { value.rollup[1].parent_id = "missing"; }],
    ["hierarchy cycle", (value: ReturnType<typeof payload>) => { value.rollup[0].parent_id = CHILD; }],
    ["duplicate center", (value: ReturnType<typeof payload>) => { value.rollup[1].cost_center_id = ROOT; }],
    ["unknown flag center", (value: ReturnType<typeof payload>) => { value.flags[0].cost_center_id = "missing"; }],
  ])("rejects %s corruption", (_label, mutate) => {
    const value = payload();
    mutate(value);
    expect(() => parseCostCenterReportsSnapshot(value, ORG, true)).toThrow("cost center reports snapshot");
  });
});
