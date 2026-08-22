import { describe, expect, it } from "vitest";
import {
  parseExpenseCorrection,
  parseExpensePaymentReversal,
  selectExpensePaymentState,
} from "./expense-payment-reversal";

const valid = {
  expenseId: "expense-id",
  movementId: "movement-id",
  outcome: "unrouted",
  reason: "  طريقة السداد خاطئة  ",
  reversalDate: "2026-08-05",
};

describe("parseExpensePaymentReversal", () => {
  it("normalizes a valid payment-only correction", () => {
    expect(parseExpensePaymentReversal(valid)).toEqual({
      ok: true,
      value: {
        expenseId: "expense-id",
        movementId: "movement-id",
        outcome: "unrouted",
        reason: "طريقة السداد خاطئة",
        reversalDate: "2026-08-05",
      },
    });
  });

  it("accepts the whole-expense cancellation outcome", () => {
    expect(parseExpensePaymentReversal({ ...valid, outcome: "cancelled" })).toMatchObject({
      ok: true,
      value: { outcome: "cancelled" },
    });
  });

  it.each([
    [{ ...valid, expenseId: " " }, "المصروف غير محدد"],
    [{ ...valid, movementId: " " }, "حركة السداد غير محددة"],
    [{ ...valid, outcome: "paid_from_custody" }, "اختر نتيجة التصحيح"],
    [{ ...valid, reason: " " }, "اكتب سبب التصحيح"],
    [{ ...valid, reason: "س".repeat(501) }, "سبب التصحيح أطول من الحد المسموح"],
    [{ ...valid, reversalDate: "2026-02-30" }, "تاريخ التصحيح غير صالح"],
    [{ ...valid, reversalDate: "05/08/2026" }, "تاريخ التصحيح غير صالح"],
  ])("rejects invalid input without calling the money RPC", (input, error) => {
    expect(parseExpensePaymentReversal(input)).toEqual({ ok: false, error });
  });
});

describe("selectExpensePaymentState", () => {
  const firstPayment = { id: "payment-1", amount_out: 100, reversal_of: null, reversed_by: "reversal-1" };
  const firstReversal = { id: "reversal-1", amount_out: 0, reversal_of: "payment-1", reversed_by: null };
  const secondPayment = { id: "payment-2", amount_out: 120, reversal_of: null, reversed_by: null };

  it("selects the active repayment instead of the first reversed attempt", () => {
    expect(selectExpensePaymentState([firstPayment, firstReversal, secondPayment])).toEqual({
      activePayment: secondPayment,
      latestReversal: undefined,
    });
  });

  it("shows the latest reversal only when no active payment remains", () => {
    const secondReversal = { id: "reversal-2", amount_out: 0, reversal_of: "payment-2", reversed_by: null };
    const reversedSecondPayment = { ...secondPayment, reversed_by: "reversal-2" };

    expect(
      selectExpensePaymentState([firstPayment, firstReversal, reversedSecondPayment, secondReversal]),
    ).toEqual({ activePayment: undefined, latestReversal: secondReversal });
  });
});

describe("parseExpenseCorrection", () => {
  const correction = {
    expenseId: "expense-id",
    date: "2026-08-01",
    category: "  سماد  ",
    description: "  دفعة مصححة  ",
    total: 1250,
    supplierId: " supplier-id ",
    accountId: " account-id ",
    costCenterId: " center-id ",
    route: "custody",
    custodyAccountId: " custody-id ",
  };

  it("normalizes a corrected expense and custody reroute", () => {
    expect(parseExpenseCorrection(correction)).toEqual({
      ok: true,
      value: {
        expenseId: "expense-id",
        date: "2026-08-01",
        category: "سماد",
        description: "دفعة مصححة",
        total: 1250,
        supplierId: "supplier-id",
        accountId: "account-id",
        costCenterId: "center-id",
        route: "custody",
        custodyAccountId: "custody-id",
      },
    });
  });

  it("allows saving the correction without immediately routing it", () => {
    expect(
      parseExpenseCorrection({
        ...correction,
        date: "",
        description: "",
        supplierId: "",
        accountId: "",
        costCenterId: "",
        route: "none",
        custodyAccountId: "",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        date: null,
        description: null,
        supplierId: null,
        accountId: null,
        costCenterId: null,
        route: "none",
        custodyAccountId: null,
      },
    });
  });

  it.each([
    [{ ...correction, category: " " }, "اكتب على ماذا صُرف المبلغ"],
    [{ ...correction, total: 0 }, "المبلغ غير صالح"],
    [{ ...correction, date: "2026-02-30" }, "تاريخ المصروف غير صالح"],
    [{ ...correction, route: "owner" }, "اختر مسار السداد"],
    [{ ...correction, custodyAccountId: "" }, "اختر العهدة التي دُفع منها"],
  ])("rejects an invalid correction", (input, error) => {
    expect(parseExpenseCorrection(input)).toEqual({ ok: false, error });
  });
});
