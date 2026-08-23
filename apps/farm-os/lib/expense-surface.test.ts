import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "app", "(app)", "expenses");
const list = readFileSync(join(APP, "page.tsx"), "utf8");
const view = readFileSync(join(APP, "expense-list-view.tsx"), "utf8");
const detail = readFileSync(join(APP, "[expenseId]", "page.tsx"), "utf8");
const actions = readFileSync(join(APP, "actions.ts"), "utf8");

describe("R4d expense workspace surface", () => {
  it("keeps the existing exact bounded read and role gates", () => {
    expect(list).toContain('requireRole(["owner", "accountant", "farm_manager"])');
    expect(list.split('sb.rpc("fn_expense_daily_snapshot"').length - 1).toBe(1);
    expect(list).toContain("p_row_limit: EXPENSE_REGISTER_DISPLAY_CAP");
    expect(detail.split('sb.rpc("fn_expense_detail_snapshot"').length - 1).toBe(1);
  });

  it("uses a phone-first stacked list and carries validated register context", () => {
    expect(view).toContain('data-testid="expense-register"');
    expect(view).toContain("expenseHrefFromList");
    expect(view).toContain("<ul");
    expect(view).not.toContain("FilterableTable");
    expect(view).not.toContain("SimpleTable");
  });

  it("keeps drawings separate and labels bounded search honestly", () => {
    expect(view).toContain("مصروفات هذا الشهر بدون المسحوبات");
    expect(view).toContain("مسحوبات هذا الشهر");
    expect(view).toContain("البحث داخل أحدث السجلات المعروضة فقط");
  });

  it("makes the 360 return to the exact validated register state", () => {
    expect(detail).toContain("parseExpenseReturnTo");
    expect(detail).toContain("href={from}");
    expect(detail).toContain('from.startsWith("/transactions?")');
    expect(detail).toContain('returnedFromTransactions ? "المعاملات" : "المصروفات"');
    expect(detail).toContain("العودة إلى {returnLabel}");
    expect(detail).toContain('name="return_to" value={from}');
    expect(actions).toContain("expenseActionHref(expenseId");
  });
});
