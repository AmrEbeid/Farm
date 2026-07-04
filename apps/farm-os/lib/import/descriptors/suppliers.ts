/** SPEC-0024 S-9 — suppliers import (fn_save_supplier, inventory.write). Matched by NAME: re-upload updates. */
import type { ImportDescriptor } from "../types";

export const suppliersDescriptor: ImportDescriptor = {
  key: "suppliers",
  titleAr: "الموردون",
  rpc: "fn_save_supplier",
  role: "inventory.write",
  table: "suppliers",
  matchKey: ["name"],
  dedupeKey: ["name"],
  columns: [
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "تبارك للأسمدة" },
    { key: "phone", labelAr: "الهاتف", type: "string", required: false, example: "01000000000" },
    { key: "terms", labelAr: "شروط الدفع", type: "string", required: false, example: "نقدي" },
    { key: "leadTimeDays", labelAr: "مدة التوريد (يوم)", type: "int", required: false, example: "3" },
  ],
  fromRow: (r) => ({ name: r.name, phone: r.phone ?? "", terms: r.terms ?? "", leadTimeDays: r.lead_time_days ?? "" }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_org: null,
    p_name: r.name,
    p_phone: r.phone ?? null,
    p_terms: r.terms ?? null,
    p_lead_time_days: r.leadTimeDays ?? null,
  }),
};
