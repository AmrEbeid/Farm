import { describe, it, expect } from "vitest";
import { accountsDescriptor } from "./accounts";
import { validateRows } from "../validate";

describe("accountsDescriptor", () => {
  it("maps a validated + ref-resolved row to the fn_save_account INSERT arg shape", () => {
    const row = {
      parentId: "parent-uuid",
      code: "5115",
      nameAr: "محسنات تربة",
      accountType: "expense",
      normalBalance: "debit",
      kind: "operating",
      sortOrder: 15,
      active: true,
    };
    expect(accountsDescriptor.toRpcArgs(row, null)).toEqual({
      p_id: null,
      p_org: null,
      p_parent_id: "parent-uuid",
      p_code: "5115",
      p_name_ar: "محسنات تربة",
      p_account_type: "expense",
      p_normal_balance: "debit",
      p_kind: "operating",
      p_sort_order: 15,
      p_active: true,
    });
  });

  it("maps to the fn_save_account UPDATE arg shape when matched", () => {
    const row = {
      code: "5115",
      nameAr: "محسنات تربة",
      accountType: "expense",
      normalBalance: "debit",
    };
    expect(accountsDescriptor.toRpcArgs(row, "existing-id")).toMatchObject({
      p_id: "existing-id",
      p_parent_id: null,
      p_code: "5115",
      p_kind: null,
      p_active: true,
    });
  });

  it("validates required fields and enum values", () => {
    const { okRows, errors } = validateRows(accountsDescriptor, [
      { parentId: "5000", code: "5115", nameAr: "محسنات تربة", accountType: "expense", normalBalance: "debit", kind: "operating", active: "true" },
      { code: "", nameAr: "", accountType: "bad", normalBalance: "bad", kind: "bad" },
    ]);
    expect(okRows[0]).toMatchObject({ parentId: "5000", code: "5115", active: true });
    expect(errors).toEqual([
      { row: 2, column: "code", reason: "حقل مطلوب" },
      { row: 2, column: "nameAr", reason: "حقل مطلوب" },
      { row: 2, column: "accountType", reason: "قيمة غير مسموح بها" },
      { row: 2, column: "normalBalance", reason: "قيمة غير مسموح بها" },
      { row: 2, column: "kind", reason: "قيمة غير مسموح بها" },
    ]);
  });

  it("declares parentId as an optional ref to active accounts.code", () => {
    const col = accountsDescriptor.columns.find((c) => c.key === "parentId");
    expect(col?.required).toBe(false);
    expect(col?.ref).toEqual({ table: "accounts", codeColumn: "code", activeColumn: "active", activeValue: true });
  });

  it("declares table, matchKey, and a matching dedupeKey for reconcile-upsert", () => {
    expect(accountsDescriptor.table).toBe("accounts");
    expect(accountsDescriptor.matchKey).toEqual(["code"]);
    expect(accountsDescriptor.dedupeKey).toEqual(accountsDescriptor.matchKey);
  });

  it("fromRow maps a DB row back to column-key-shaped values", () => {
    const dbRow = {
      parent_id: "parent-uuid",
      code: "5110",
      name_ar: "أسمدة",
      account_type: "expense",
      normal_balance: "debit",
      kind: "operating",
      sort_order: 10,
      active: true,
    };
    expect(accountsDescriptor.fromRow?.(dbRow)).toEqual({
      parentId: "parent-uuid",
      code: "5110",
      nameAr: "أسمدة",
      accountType: "expense",
      normalBalance: "debit",
      kind: "operating",
      sortOrder: 10,
      active: true,
    });
  });
});
