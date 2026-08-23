import { describe, expect, it } from "vitest";
import { expenseHref } from "./expense-list-context";
import {
  TRANSACTIONS_PATH,
  TRANSACTION_QUERY_MAX_LENGTH,
  parseTransactionsListContext,
  parseTransactionsReturnTo,
  transactionNextStep,
  transactionRowTarget,
  transactionSearchMatches,
  transactionsListHref,
} from "./transactions-list-context";

const EXPENSE_ID = "33333333-3333-4333-8333-333333333331";
const MOVEMENT_ID = "44444444-4444-4444-8444-444444444441";
const BUYER_ID = "55555555-5555-4555-8555-555555555551";

describe("transactions list url state", () => {
  it("accepts only the four real transaction types", () => {
    expect(parseTransactionsListContext({})).toEqual({ type: null, query: "" });
    for (const type of ["expense", "sale", "collection", "custody"] as const) {
      expect(parseTransactionsListContext({ type })).toEqual({ type, query: "" });
    }
    for (const type of ["payroll", "EXPENSE", "constructor", "__proto__", "toString", ""]) {
      expect(parseTransactionsListContext({ type }).type, type).toBeNull();
    }
  });

  it("normalizes and bounds the search text", () => {
    expect(parseTransactionsListContext({ q: "  سماد  " }).query).toBe("سماد");
    expect(parseTransactionsListContext({ q: `سماد${String.fromCharCode(0)}` }).query).toBe("سماد");
    expect(parseTransactionsListContext({ q: "س".repeat(200) }).query)
      .toHaveLength(TRANSACTION_QUERY_MAX_LENGTH);
    expect(parseTransactionsListContext({ q: undefined }).query).toBe("");
  });

  it("builds one clean ledger url", () => {
    expect(transactionsListHref()).toBe(TRANSACTIONS_PATH);
    expect(transactionsListHref({ type: "sale" })).toBe("/transactions?type=sale");
    expect(transactionsListHref({ type: "sale", query: "برحي" }))
      .toBe(`/transactions?q=${encodeURIComponent("برحي")}&type=sale`);
    expect(transactionsListHref({ query: "برحي" }))
      .toBe(`/transactions?q=${encodeURIComponent("برحي")}`);
  });

  it("rebuilds a safe ledger return path and rejects every other destination", () => {
    expect(parseTransactionsReturnTo("/transactions?type=custody&q=عهدة"))
      .toBe(`/transactions?q=${encodeURIComponent("عهدة")}&type=custody`);
    expect(parseTransactionsReturnTo("/transactions?type=payroll&evil=1")).toBe(TRANSACTIONS_PATH);
    for (const raw of [
      undefined,
      "",
      "https://evil.example/transactions",
      "//evil.example",
      "/\\evil.example",
      "/expenses",
      "/transactions/../admin",
      "/transactionsX",
      "/transactions/not-a-list",
      `/transactions${String.fromCharCode(10)}`,
      `/transactions?q=${"س".repeat(400)}`,
    ]) {
      expect(parseTransactionsReturnTo(raw), String(raw)).toBe(TRANSACTIONS_PATH);
    }
  });

  it("preserves a legitimate maximum-length Arabic query through the nested expense return URL", () => {
    const query = "س".repeat(TRANSACTION_QUERY_MAX_LENGTH);
    const from = transactionsListHref({ type: "expense", query });
    expect(parseTransactionsReturnTo(from)).toBe(from);
    const target = transactionRowTarget({ id: EXPENSE_ID, type: "expense", party_id: null }, { type: "expense", query });
    expect(new URLSearchParams((target.href ?? "").split("?")[1]).get("from")).toBe(from);
  });
});

describe("transactionRowTarget", () => {
  const context = { type: "expense" as const, query: "سماد" };

  it("sends an expense row to the existing expense 360 carrying the validated ledger state", () => {
    const target = transactionRowTarget({ id: EXPENSE_ID, type: "expense", party_id: null }, context);
    expect(target.href).toBe(expenseHref(EXPENSE_ID, "overview", transactionsListHref(context)));
    expect(target.reason).toBeNull();
    const from = new URLSearchParams((target.href ?? "").split("?")[1]).get("from");
    expect(parseTransactionsReturnTo(from ?? undefined))
      .toBe(`/transactions?q=${encodeURIComponent("سماد")}&type=expense`);
    expect(transactionRowTarget(
      { id: EXPENSE_ID, type: "expense", party_id: null },
      { type: null, query: "" },
    ).href).toBe(`/expenses/${EXPENSE_ID}?from=${encodeURIComponent(TRANSACTIONS_PATH)}`);
  });

  it("sends a custody row to the existing custody movement page", () => {
    expect(transactionRowTarget({ id: MOVEMENT_ID, type: "custody", party_id: null }, context).href)
      .toBe(`/custody/movements/${MOVEMENT_ID}`);
  });

  it("sends a sale to the buyer 360 only when the party id is a real buyer reference", () => {
    expect(transactionRowTarget({ id: "sale-1", type: "sale", party_id: BUYER_ID }, context).href)
      .toBe(`/finance/buyers/${BUYER_ID}`);
    const unlinked = transactionRowTarget({ id: "sale-1", type: "sale", party_id: null }, context);
    expect(unlinked.href).toBeNull();
    expect(unlinked.reason).toBe("بيع بلا عميل مسجل — لا يوجد ملف عميل لفتحه");
  });

  it("never invents a destination for a collection", () => {
    const target = transactionRowTarget({ id: "col-1", type: "collection", party_id: null }, context);
    expect(target.href).toBeNull();
    expect(target.reason).toBe("لا توجد صفحة تفصيل لهذا التحصيل بعد");
  });

  it("refuses to build a link from an id that is not a real record reference", () => {
    for (const id of ["", "not-a-uuid", "../admin", `${EXPENSE_ID} `.replace(" ", "/")]) {
      expect(transactionRowTarget({ id, type: "expense", party_id: null }, context).href, id).toBeNull();
      expect(transactionRowTarget({ id, type: "custody", party_id: null }, context).href, id).toBeNull();
    }
    expect(transactionRowTarget({ id: "sale-1", type: "sale", party_id: "../admin" }, context).href)
      .toBeNull();
  });
});

describe("transactionNextStep", () => {
  const base = { event_date: "2026-08-20", amount: "10.00", pending_price: false, party_id: BUYER_ID };

  it("reports an unknown expense amount as unknown before anything else", () => {
    expect(transactionNextStep({ ...base, type: "expense", amount: null }))
      .toEqual({ label: "المبلغ غير مسجل — أكمل بيانات المصروف", attention: true });
  });

  it("asks for a missing expense date, then settles on review", () => {
    expect(transactionNextStep({ ...base, type: "expense", event_date: null }))
      .toEqual({ label: "بدون تاريخ — أضف تاريخ المصروف", attention: true });
    expect(transactionNextStep({ ...base, type: "expense" }))
      .toEqual({ label: "افتح ملف المصروف", attention: false });
  });

  it("names the pending sale price ahead of every other sale gap", () => {
    expect(transactionNextStep({ ...base, type: "sale", pending_price: true, amount: null, event_date: null }))
      .toEqual({ label: "السعر معلّق — حدّده ليدخل الدفاتر", attention: true });
    expect(transactionNextStep({ ...base, type: "sale", party_id: null }))
      .toEqual({ label: "بيع بلا عميل مسجل — راجع البيع", attention: true });
    expect(transactionNextStep({ ...base, type: "sale", event_date: null }))
      .toEqual({ label: "بدون تاريخ — راجع البيع", attention: true });
    expect(transactionNextStep({ ...base, type: "sale" }))
      .toEqual({ label: "افتح ملف العميل", attention: false });
  });

  it("states honestly that a collection has no detail page yet", () => {
    expect(transactionNextStep({ ...base, type: "collection" }))
      .toEqual({ label: "تحصيل مسجل — لا توجد صفحة تفصيل بعد", attention: false });
    expect(transactionNextStep({ ...base, type: "collection", event_date: null }))
      .toEqual({ label: "بدون تاريخ — راجع التحصيل في مصدره", attention: true });
  });

  it("sends a custody movement to its own page", () => {
    expect(transactionNextStep({ ...base, type: "custody" }))
      .toEqual({ label: "افتح حركة العهدة", attention: false });
    expect(transactionNextStep({ ...base, type: "custody", event_date: null }))
      .toEqual({ label: "بدون تاريخ — راجع حركة العهدة", attention: true });
  });
});

describe("transactionSearchMatches", () => {
  it("matches an empty query against everything", () => {
    expect(transactionSearchMatches([null], "")).toBe(true);
    expect(transactionSearchMatches([], "   ")).toBe(true);
  });

  it("matches Arabic text case- and digit-form-insensitively", () => {
    expect(transactionSearchMatches(["سماد بوتاسي", null], "سماد")).toBe(true);
    expect(transactionSearchMatches(["١٢٣٤"], "1234")).toBe(true);
    expect(transactionSearchMatches(["1٬234٫50"], "1234.5")).toBe(true);
    expect(transactionSearchMatches(["Diesel"], "diesel")).toBe(true);
  });

  it("does not match text that is absent from every searched field", () => {
    expect(transactionSearchMatches(["سماد", "مورد"], "جرار")).toBe(false);
    expect(transactionSearchMatches([null, undefined], "سماد")).toBe(false);
  });
});
