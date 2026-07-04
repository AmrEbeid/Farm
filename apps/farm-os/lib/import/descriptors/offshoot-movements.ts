/**
 * SPEC-0024 S-7 import descriptor for بنك الفسائل movements.
 * Writes through fn_record_offshoot_movement, the same plan.write-gated RPC used by the UI.
 */
import type { ImportDescriptor } from "../types";

export const offshootMovementsDescriptor: ImportDescriptor = {
  key: "offshoot-movements",
  titleAr: "حركات بنك الفسائل",
  rpc: "fn_record_offshoot_movement",
  role: "plan.write",
  columns: [
    {
      key: "movementDate",
      labelAr: "التاريخ",
      type: "date",
      required: false,
      format: "YYYY-MM-DD",
      example: "2026-07-04",
    },
    {
      key: "movementType",
      labelAr: "نوع الحركة",
      type: "enum",
      required: true,
      enumValues: ["produce", "plant", "sell", "replant"],
      example: "plant",
    },
    { key: "qty", labelAr: "الكمية", type: "decimal", required: true, example: "50" },
    {
      key: "sourceCostCenterId",
      labelAr: "كود مركز المصدر",
      type: "string",
      required: false,
      example: "CC-HSW-PALM",
      ref: { table: "cost_centers", codeColumn: "code", activeColumn: "active", activeValue: true },
    },
    {
      key: "destCostCenterId",
      labelAr: "كود مركز الوجهة",
      type: "string",
      required: false,
      example: "CC-BAB-PALM",
      ref: { table: "cost_centers", codeColumn: "code", activeColumn: "active", activeValue: true },
    },
    { key: "note", labelAr: "ملاحظة", type: "string", required: false, example: "إحلال نخيل ميت" },
  ],
  toRpcArgs: (r) => ({
    p_org: null,
    p_movement_type: r.movementType,
    p_qty: r.qty,
    p_movement_date: r.movementDate ?? null,
    p_source_cost_center_id: r.sourceCostCenterId ?? null,
    p_dest_cost_center_id: r.destCostCenterId ?? null,
    p_note: r.note ?? null,
  }),
};
