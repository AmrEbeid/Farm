/**
 * Import descriptor for farm sectors (pilot). Writes through `fn_save_sector` — the same
 * SECURITY DEFINER RPC the single-record form uses (gate: structure.write = owner/farm_manager,
 * enforced in the DB). Mirrors the arg shape in app/(app)/farm/structure-actions.ts.
 *
 * NOTE (open, owner to confirm): `p_farm_id` is sent null here. If the RPC does not default it
 * to the caller's active farm, commits return a clean per-row error (no bad data) until the
 * route injects the active-farm context. See spec §6 / the framework report.
 */
import type { ImportDescriptor } from "../types";

export const sectorsDescriptor: ImportDescriptor = {
  key: "sectors",
  titleAr: "القطاعات",
  rpc: "fn_save_sector",
  role: "structure.write",
  columns: [
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "القطاع الشمالي" },
    { key: "code", labelAr: "الكود", type: "string", required: true, example: "S-01" },
    { key: "crop", labelAr: "المحصول", type: "string", required: false, example: "نخيل برحي" },
    { key: "areaFeddan", labelAr: "المساحة (فدان)", type: "decimal", required: false, example: "12.5" },
    { key: "plantingDate", labelAr: "تاريخ الزراعة", type: "date", required: false, format: "YYYY-MM-DD", example: "2020-03-01" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
  ],
  toRpcArgs: (r) => ({
    p_id: null,
    p_farm_id: null,
    p_name: r.name,
    p_code: r.code,
    p_crop: r.crop ?? null,
    p_area_feddan: r.areaFeddan ?? null,
    p_planting_date: r.plantingDate ?? null,
    p_notes: r.notes ?? null,
  }),
};
