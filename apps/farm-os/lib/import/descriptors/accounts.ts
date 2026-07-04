/**
 * Import descriptor for the editable chart of accounts. Writes through `fn_save_account`
 * so bulk changes use the same budget.write-gated RPC path as the future tree editor.
 * `parentId` is optional: blank means a root account; otherwise the typed account code
 * is resolved to a parent account id within the user's RLS-scoped org.
 */
import type { ImportDescriptor } from "../types";

export const accountsDescriptor: ImportDescriptor = {
  key: "accounts",
  titleAr: "دليل الحسابات",
  rpc: "fn_save_account",
  role: "budget.write",
  table: "accounts",
  matchKey: ["code"],
  dedupeKey: ["code"],
  columns: [
    { key: "parentId", labelAr: "كود الحساب الأب", type: "string", required: false, example: "5000", ref: { table: "accounts", codeColumn: "code", activeColumn: "active", activeValue: true } },
    { key: "code", labelAr: "الكود", type: "string", required: true, example: "5110" },
    { key: "nameAr", labelAr: "الاسم", type: "string", required: true, example: "أسمدة" },
    { key: "accountType", labelAr: "نوع الحساب", type: "enum", required: true, enumValues: ["asset", "liability", "equity", "revenue", "expense"], example: "expense" },
    { key: "normalBalance", labelAr: "طبيعة الرصيد", type: "enum", required: true, enumValues: ["debit", "credit"], example: "debit" },
    { key: "kind", labelAr: "تصنيف المصروف", type: "enum", required: false, enumValues: ["operating", "drawing", "capex"], example: "operating" },
    { key: "sortOrder", labelAr: "ترتيب العرض", type: "int", required: false, example: "10" },
    { key: "active", labelAr: "نشط", type: "bool", required: false, example: "true" },
  ],
  fromRow: (r) => ({
    parentId: r.parent_id ?? "",
    code: r.code,
    nameAr: r.name_ar,
    accountType: r.account_type,
    normalBalance: r.normal_balance,
    kind: r.kind ?? "",
    sortOrder: r.sort_order ?? "",
    active: r.active ?? true,
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_org: null,
    p_parent_id: r.parentId ?? null,
    p_code: r.code,
    p_name_ar: r.nameAr,
    p_account_type: r.accountType,
    p_normal_balance: r.normalBalance,
    p_kind: r.kind ?? null,
    p_sort_order: r.sortOrder ?? null,
    p_active: r.active ?? true,
  }),
};
