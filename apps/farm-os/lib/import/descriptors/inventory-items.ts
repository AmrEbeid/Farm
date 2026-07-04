/** SPEC-0024 S-9 — inventory items import (fn_save_inventory_item, inventory.write). Matched by NAME.
 *  Preferred supplier by NAME (resolved to id — users never paste UUIDs). */
import type { ImportDescriptor } from "../types";

export const inventoryItemsDescriptor: ImportDescriptor = {
  key: "inventory-items",
  titleAr: "أصناف المخزون",
  rpc: "fn_save_inventory_item",
  role: "inventory.write",
  table: "inventory_items",
  matchKey: ["name"],
  dedupeKey: ["name"],
  columns: [
    { key: "name", labelAr: "اسم الصنف", type: "string", required: true, example: "سلفات نشادر 20.5%" },
    { key: "category", labelAr: "التصنيف", type: "string", required: false, example: "سماد" },
    { key: "unit", labelAr: "الوحدة", type: "string", required: false, example: "شيكارة" },
    { key: "packSize", labelAr: "حجم العبوة", type: "decimal", required: false, example: "50" },
    { key: "minStock", labelAr: "الحد الأدنى", type: "decimal", required: false, example: "10" },
    { key: "safetyStock", labelAr: "مخزون الأمان", type: "decimal", required: false, example: "5" },
    { key: "reorderPoint", labelAr: "حد إعادة الطلب", type: "decimal", required: false, example: "20" },
    { key: "reorderQty", labelAr: "كمية إعادة الطلب", type: "decimal", required: false, example: "40" },
    { key: "leadTimeDays", labelAr: "مدة التوريد (يوم)", type: "int", required: false, example: "3" },
    {
      key: "preferredSupplierId",
      labelAr: "المورد المفضل (بالاسم)",
      type: "string",
      required: false,
      example: "تبارك للأسمدة",
      ref: { table: "suppliers", codeColumn: "name" },
    },
  ],
  fromRow: (r) => ({
    name: r.name, category: r.category ?? "", unit: r.unit ?? "", packSize: r.pack_size ?? "",
    minStock: r.min_stock ?? "", safetyStock: r.safety_stock ?? "", reorderPoint: r.reorder_point ?? "",
    reorderQty: r.reorder_qty ?? "", leadTimeDays: r.lead_time_days ?? "", preferredSupplierId: "",
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_org: null,
    p_name: r.name,
    p_category: r.category ?? null,
    p_unit: r.unit ?? null,
    p_pack_size: r.packSize ?? null,
    p_min_stock: r.minStock ?? null,
    p_safety_stock: r.safetyStock ?? null,
    p_reorder_point: r.reorderPoint ?? null,
    p_reorder_qty: r.reorderQty ?? null,
    p_lead_time_days: r.leadTimeDays ?? null,
    p_preferred_supplier_id: r.preferredSupplierId ?? null,
  }),
};
