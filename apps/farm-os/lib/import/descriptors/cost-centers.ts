/**
 * Import descriptor for cost centers (مراكز التكلفة). Writes through `fn_save_cost_center`
 * so bulk edits use the same budget.write-gated RPC path as the cost-center editor.
 * Parent cost center and linked physical sector are typed as human codes, then resolved to ids.
 */
import type { ImportDescriptor } from "../types";

export const costCentersDescriptor: ImportDescriptor = {
  key: "cost-centers",
  titleAr: "مراكز التكلفة",
  rpc: "fn_save_cost_center",
  role: "budget.write",
  table: "cost_centers",
  matchKey: ["code"],
  dedupeKey: ["code"],
  columns: [
    { key: "parentId", labelAr: "كود المركز الأب", type: "string", required: false, example: "CC-HSW", ref: { table: "cost_centers", codeColumn: "code", activeColumn: "active", activeValue: true } },
    { key: "code", labelAr: "الكود", type: "string", required: true, example: "CC-HSW-PALM" },
    { key: "nameAr", labelAr: "الاسم", type: "string", required: true, example: "نخيل الحصوه" },
    { key: "sectorId", labelAr: "كود القطاع المرتبط", type: "string", required: false, example: "HSW", ref: { table: "sectors", codeColumn: "code", activeColumn: "archived", activeValue: false } },
    { key: "enterprise", labelAr: "النشاط", type: "string", required: false, example: "نخيل" },
    { key: "areaFeddan", labelAr: "المساحة (فدان)", type: "decimal", required: false, example: "14" },
    { key: "sortOrder", labelAr: "ترتيب العرض", type: "int", required: false, example: "12" },
    { key: "active", labelAr: "نشط", type: "bool", required: false, example: "true" },
  ],
  fromRow: (r) => ({
    parentId: r.parent_id ?? "",
    code: r.code,
    nameAr: r.name_ar,
    sectorId: r.sector_id ?? "",
    enterprise: r.enterprise ?? "",
    areaFeddan: r.area_feddan ?? "",
    sortOrder: r.sort_order ?? "",
    active: r.active ?? true,
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_org: null,
    p_parent_id: r.parentId ?? null,
    p_code: r.code,
    p_name_ar: r.nameAr,
    p_sector_id: r.sectorId ?? null,
    p_enterprise: r.enterprise ?? null,
    p_area_feddan: r.areaFeddan ?? null,
    p_sort_order: r.sortOrder ?? null,
    p_active: r.active ?? true,
  }),
};
