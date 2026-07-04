/**
 * SPEC-0024 S-9 import descriptor for sales deliveries (المبيعات). Writes through fn_save_sale — every
 * imported row is a PENDING delivery (qty + crop + buyer, NO price): the delivery-before-price mechanic.
 * Prices are then finalized one-by-one (fn_finalize_sale_price posts the journal), so a bulk import can
 * never fabricate revenue (#1). Insert-only — finalized sales are immutable and never matched/updated.
 * Buyer and cost center are given by NAME/CODE and resolved to ids (users never paste UUIDs).
 */
import type { ImportDescriptor } from "../types";

export const salesDescriptor: ImportDescriptor = {
  key: "sales",
  titleAr: "المبيعات (تسليمات بسعر لاحق)",
  rpc: "fn_save_sale",
  role: "budget.write",
  columns: [
    { key: "saleDate", labelAr: "التاريخ", type: "date", required: false, format: "YYYY-MM-DD", example: "2026-07-04" },
    { key: "crop", labelAr: "المحصول", type: "string", required: true, example: "برحي" },
    {
      key: "buyerId",
      labelAr: "اسم المشتري",
      type: "string",
      required: false,
      example: "تاجر التمور",
      ref: { table: "buyers", codeColumn: "name", activeColumn: "active", activeValue: true },
    },
    {
      key: "costCenterId",
      labelAr: "كود مركز التكلفة",
      type: "string",
      required: false,
      example: "CC-HSW-PALM",
      ref: { table: "cost_centers", codeColumn: "code", activeColumn: "active", activeValue: true },
    },
    { key: "season", labelAr: "الموسم", type: "string", required: false, example: "2026" },
    { key: "qty", labelAr: "الكمية", type: "decimal", required: false, example: "1200" },
    { key: "unit", labelAr: "الوحدة", type: "string", required: false, example: "كجم" },
    { key: "deliveryDate", labelAr: "تاريخ التسليم", type: "date", required: false, format: "YYYY-MM-DD", example: "2026-07-04" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
  ],
  toRpcArgs: (r) => ({
    p_id: null,
    p_org: null,
    p_sale_date: r.saleDate ?? null,
    p_crop: r.crop,
    p_buyer_id: r.buyerId ?? null,
    p_cost_center_id: r.costCenterId ?? null,
    p_farm_id: null,
    p_sector_id: null,
    p_hawsha_id: null,
    p_season: r.season ?? null,
    p_qty: r.qty ?? null,
    p_unit: r.unit ?? null,
    p_delivery_date: r.deliveryDate ?? null,
    p_notes: r.notes ?? null,
  }),
};
