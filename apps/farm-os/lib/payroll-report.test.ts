import { describe, it, expect } from "vitest";
import { PAYROLL_UNKNOWN_LABEL_AR, payrollModeLabel, payrollQuantityUnitLabel } from "./payroll-report";

// R4b retired loadPayrollRunHistory/loadPayrollRunDetail (the direct payroll_runs/payroll_run_lines
// PostgREST reads) along with the workspace/run-360 pages that used them — see
// lib/payroll-snapshot-reads.test.ts for the RPC-payload parser these pages now read through instead,
// and lib/payroll-surface.test.ts for the "no direct table read" guard. What remains here is the pure
// wage-mode/unit label vocabulary, which never touched the database.

describe("payroll labels", () => {
  it("names every stored mode in Arabic", () => {
    expect(payrollModeLabel("hourly")).toBe("بالساعة");
    expect(payrollModeLabel("daily")).toBe("باليوم");
    expect(payrollModeLabel("piece")).toBe("بالقطعة");
    expect(payrollModeLabel("seasonal")).toBe("موسمي");
    expect(payrollModeLabel("something-new")).toBe(PAYROLL_UNKNOWN_LABEL_AR);
  });

  it("names the unit a line's quantity is measured in", () => {
    expect(payrollQuantityUnitLabel("hourly", null)).toBe("ساعة");
    expect(payrollQuantityUnitLabel("daily", null)).toBe("يوم");
    expect(payrollQuantityUnitLabel("seasonal", null)).toBe("فترة");
    expect(payrollQuantityUnitLabel("piece", "tree")).toBe("نخلة");
    expect(payrollQuantityUnitLabel("piece", "kg")).toBe("كيلوجرام");
    // A piece line with no unit is impossible in the schema; it still must not render blank.
    expect(payrollQuantityUnitLabel("piece", null)).toBe(PAYROLL_UNKNOWN_LABEL_AR);
    expect(payrollQuantityUnitLabel("piece", "furlong")).toBe(PAYROLL_UNKNOWN_LABEL_AR);
  });
});
