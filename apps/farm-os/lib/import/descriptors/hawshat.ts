/**
 * Import descriptor for hawshat (أحواش). Writes through `fn_save_hawsha` (gate:
 * structure.write, enforced in the DB). Mirrors the arg shape in
 * app/(app)/farm/structure-actions.ts. The parent sector is given by its CODE,
 * resolved to sector_id via the ref lookup (RLS-scoped).
 */
import type { ImportDescriptor } from "../types";

export const hawshatDescriptor: ImportDescriptor = {
  key: "hawshat",
  titleAr: "الأحواش",
  rpc: "fn_save_hawsha",
  role: "structure.write",
  columns: [
    { key: "sectorId", labelAr: "كود القطاع", type: "string", required: true, example: "S-01", ref: { table: "sectors", codeColumn: "code", activeColumn: "archived", activeValue: false } },
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "الحوش 1" },
    { key: "code", labelAr: "الكود", type: "string", required: true, example: "H-01" },
    { key: "areaQirat", labelAr: "المساحة (قيراط)", type: "decimal", required: false, example: "6" },
    { key: "rowCount", labelAr: "عدد الصفوف", type: "int", required: false, example: "10" },
    { key: "palmCountBarhi", labelAr: "عدد نخيل برحي", type: "int", required: false, example: "120" },
    { key: "palmCountMale", labelAr: "عدد ذكور", type: "int", required: false, example: "8" },
    { key: "plantingDate", labelAr: "تاريخ الزراعة", type: "date", required: false, format: "YYYY-MM-DD", example: "2020-03-01" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
  ],
  toRpcArgs: (r) => ({
    p_id: null,
    p_sector_id: r.sectorId, // resolved from the sector code by resolveRefs
    p_name: r.name,
    p_code: r.code,
    p_area_qirat: r.areaQirat ?? null,
    p_row_count: r.rowCount ?? null,
    p_palm_count_barhi: r.palmCountBarhi ?? null,
    p_palm_count_male: r.palmCountMale ?? null,
    p_planting_date: r.plantingDate ?? null,
    p_notes: r.notes ?? null,
  }),
};
