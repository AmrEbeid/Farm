/** SPEC-0024 S-9 — expenses import (fn_save_expense, budget.write). INSERT-only: imported expenses
 *  arrive UNROUTED (no payment status) — a bulk import can never move cash (#1); routing stays a
 *  one-by-one UI act. Supplier by NAME, account by CODE, cost center by CODE. */
import type { ImportDescriptor } from "../types";

export const expensesDescriptor: ImportDescriptor = {
  key: "expenses",
  titleAr: "المصروفات",
  rpc: "fn_save_expense",
  role: "budget.write",
  columns: [
    { key: "date", labelAr: "التاريخ", type: "date", required: false, format: "YYYY-MM-DD", example: "2026-07-04" },
    { key: "category", labelAr: "البند", type: "string", required: true, example: "أسمدة" },
    { key: "total", labelAr: "المبلغ (ج.م)", type: "decimal", required: true, example: "2500" },
    { key: "description", labelAr: "البيان", type: "string", required: false, example: "" },
    {
      key: "supplierId", labelAr: "المورد (بالاسم)", type: "string", required: false, example: "تبارك للأسمدة",
      ref: { table: "suppliers", codeColumn: "name" },
    },
    {
      key: "kind", labelAr: "النوع", type: "enum", required: false,
      enumValues: ["operating", "drawing", "capex"], example: "operating",
    },
    {
      key: "accountId", labelAr: "كود الحساب", type: "string", required: false, example: "5-1-1",
      ref: { table: "accounts", codeColumn: "code", activeColumn: "active", activeValue: true },
    },
    {
      key: "costCenterId", labelAr: "كود مركز التكلفة", type: "string", required: false, example: "CC-HSW-PALM",
      ref: { table: "cost_centers", codeColumn: "code", activeColumn: "active", activeValue: true },
    },
  ],
  toRpcArgs: (r) => ({
    p_id: null,
    p_org: null,
    p_date: r.date ?? null,
    p_category: r.category,
    p_total: r.total,
    p_description: r.description ?? null,
    p_supplier_id: r.supplierId ?? null,
    p_kind: r.kind || "operating",
    p_account_id: r.accountId ?? null,
    p_cost_center_id: r.costCenterId ?? null,
  }),
};
