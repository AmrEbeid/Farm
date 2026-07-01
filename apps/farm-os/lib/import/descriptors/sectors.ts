/**
 * Import descriptor for farm sectors. Writes through `fn_save_sector` — the same SECURITY
 * DEFINER RPC the single-record form uses (gate: structure.write = owner/farm_manager,
 * enforced in the DB). Mirrors the arg shape in app/(app)/farm/structure-actions.ts.
 *
 * The parent farm is given by its CODE (resolved to farm_id via the ref lookup, RLS-scoped),
 * so users never paste UUIDs.
 */
import type { ImportDescriptor } from "../types";

export const sectorsDescriptor: ImportDescriptor = {
  key: "sectors",
  titleAr: "القطاعات",
  rpc: "fn_save_sector",
  role: "structure.write",
  table: "sectors",
  archiveType: "sector",
  matchKey: ["code"],
  columns: [
    { key: "farmId", labelAr: "كود المزرعة", type: "string", required: true, example: "F-01", ref: { table: "farms", codeColumn: "code", activeColumn: "archived", activeValue: false } },
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "القطاع الشمالي" },
    { key: "code", labelAr: "الكود", type: "string", required: true, example: "S-01" },
    { key: "crop", labelAr: "المحصول", type: "string", required: false, example: "نخيل برحي" },
    { key: "areaFeddan", labelAr: "المساحة (فدان)", type: "decimal", required: false, example: "12.5" },
    { key: "plantingDate", labelAr: "تاريخ الزراعة", type: "date", required: false, format: "YYYY-MM-DD", example: "2020-03-01" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
  ],
  fromRow: (r) => ({
    farmId: r.farm_id,
    name: r.name,
    code: r.code,
    crop: r.crop ?? "",
    areaFeddan: r.area_feddan ?? "",
    plantingDate: r.planting_date ?? "",
    notes: r.notes ?? "",
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_farm_id: r.farmId, // resolved from the farm code by resolveRefs
    p_name: r.name,
    p_code: r.code,
    p_crop: r.crop ?? null,
    p_area_feddan: r.areaFeddan ?? null,
    p_planting_date: r.plantingDate ?? null,
    p_notes: r.notes ?? null,
  }),
};
