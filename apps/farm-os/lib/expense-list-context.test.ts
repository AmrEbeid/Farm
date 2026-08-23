import { describe, expect, it } from "vitest";
import {
  EXPENSES_PATH,
  expenseActionHref,
  expenseHref,
  expenseHrefFromList,
  expenseListHref,
  expenseNotice,
  parseExpenseListContext,
  parseExpenseReturnTo,
  parseExpenseTab,
} from "./expense-list-context";

const EXPENSE = "22222222-2222-4222-8222-222222222221";

describe("expense register url state", () => {
  it("normalizes the filter and bounded search text", () => {
    expect(parseExpenseListContext({})).toEqual({ filter: "all", query: "" });
    expect(parseExpenseListContext({ filter: "unclassified", q: "  سماد  " }))
      .toEqual({ filter: "unclassified", query: "سماد" });
    expect(parseExpenseListContext({ filter: "unknown", q: `سماد${String.fromCharCode(0)}` }))
      .toEqual({ filter: "all", query: "سماد" });
    expect(parseExpenseListContext({ q: "س".repeat(200) }).query).toHaveLength(60);
  });

  it("builds one clean register url", () => {
    expect(expenseListHref()).toBe(EXPENSES_PATH);
    expect(expenseListHref({ filter: "month" })).toBe("/expenses?filter=month");
    expect(expenseListHref({ filter: "month", query: "وقود" }))
      .toBe(`/expenses?q=${encodeURIComponent("وقود")}&filter=month`);
  });

  it("rebuilds a safe return path and rejects every other destination", () => {
    expect(parseExpenseReturnTo("/expenses?filter=unrouted&q=نقدي"))
      .toBe(`/expenses?q=${encodeURIComponent("نقدي")}&filter=unrouted`);
    expect(parseExpenseReturnTo("/expenses?filter=unknown&evil=1")).toBe(EXPENSES_PATH);
    for (const raw of [
      undefined,
      "https://evil.example/expenses",
      "//evil.example",
      "/\\evil.example",
      "/transactions",
      "/expenses/not-a-list",
      `/expenses${String.fromCharCode(10)}`,
    ]) {
      expect(parseExpenseReturnTo(raw), String(raw)).toBe(EXPENSES_PATH);
    }
  });

  it("carries the register state into an expense and preserves it across tabs", () => {
    expect(expenseHrefFromList(EXPENSE, { filter: "all", query: "" }))
      .toBe(`/expenses/${EXPENSE}`);
    const href = expenseHrefFromList(EXPENSE, { filter: "unclassified", query: "سماد" });
    const from = new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("from");
    expect(parseExpenseReturnTo(from ?? undefined))
      .toBe(`/expenses?q=${encodeURIComponent("سماد")}&filter=unclassified`);
    expect(expenseHref(EXPENSE, "activity", from))
      .toBe(`/expenses/${EXPENSE}?tab=activity&from=${encodeURIComponent(from ?? "")}`);
  });

  it("accepts only real expense tabs", () => {
    expect(parseExpenseTab(undefined)).toBe("overview");
    expect(parseExpenseTab("links")).toBe("links");
    expect(parseExpenseTab("activity")).toBe("activity");
    expect(parseExpenseTab("money")).toBe("overview");
  });

  it("keeps a safe register return path through a server-action result", () => {
    expect(expenseActionHref(EXPENSE, "ok", "date_saved", "/expenses?filter=undated"))
      .toBe(`/expenses/${EXPENSE}?ok=date_saved&from=${encodeURIComponent("/expenses?filter=undated")}`);
    expect(expenseActionHref(EXPENSE, "error", "invalid_date", "https://evil.example"))
      .toBe(`/expenses/${EXPENSE}?error=invalid_date`);
    expect(expenseNotice("date_saved")).toBe("تم حفظ تاريخ المصروف");
    expect(expenseNotice("anything supplied by a caller")).toBeNull();
    expect(expenseNotice("constructor")).toBeNull();
    expect(expenseNotice("toString")).toBeNull();
  });
});
