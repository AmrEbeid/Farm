import { describe, expect, it } from "vitest";
import { expenseNextStep, expenseSearchMatches } from "./expense-workspace-display";

const complete = {
  date: "2026-08-01",
  category: "تسميد",
  description: "سماد عضوي",
  supplier: "شركة النيل",
  account: "5100 — مستلزمات",
  accountId: "44444444-4444-4444-8444-444444444444",
  kind: "تشغيلي",
  total: "1200.00",
  paymentStatus: "post_paid_unpaid",
  costCenterId: "33333333-3333-4333-8333-333333333333",
};

describe("expense workspace display decisions", () => {
  it("names exactly one legal next step in priority order", () => {
    expect(expenseNextStep({ ...complete, date: null })).toEqual({ label: "أضف التاريخ", attention: true });
    expect(expenseNextStep({ ...complete, accountId: null })).toEqual({ label: "صنّف الحساب", attention: true });
    expect(expenseNextStep({ ...complete, account: null })).toEqual({ label: "راجع التفاصيل", attention: false });
    expect(expenseNextStep({ ...complete, costCenterId: null })).toEqual({ label: "اربط مركز تكلفة", attention: true });
    expect(expenseNextStep({ ...complete, paymentStatus: null })).toEqual({ label: "حدّد مسار السداد", attention: true });
    expect(expenseNextStep(complete)).toEqual({ label: "راجع التفاصيل", attention: false });
  });

  it("searches only visible descriptive fields and normalizes Arabic case-insensitively", () => {
    expect(expenseSearchMatches(complete, "سماد")).toBe(true);
    expect(expenseSearchMatches(complete, "النيل")).toBe(true);
    expect(expenseSearchMatches(complete, "5100")).toBe(true);
    expect(expenseSearchMatches(complete, "١٢٠٠")).toBe(true);
    expect(expenseSearchMatches(complete, "١٬٢٠٠٫٠٠")).toBe(true);
    expect(expenseSearchMatches(complete, "رأسمالي")).toBe(false);
    expect(expenseSearchMatches(complete, "  ")).toBe(true);
  });
});
