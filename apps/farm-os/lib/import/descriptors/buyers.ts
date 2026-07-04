/**
 * SPEC-0024 S-9 import descriptor for buyers (المشترون). Writes through fn_save_buyer — the same
 * budget.write-gated RPC the revenue flows use. Matches existing buyers by NAME (unique per org), so
 * a re-uploaded template updates type/phone/active instead of duplicating.
 */
import type { ImportDescriptor } from "../types";

export const buyersDescriptor: ImportDescriptor = {
  key: "buyers",
  titleAr: "المشترون",
  rpc: "fn_save_buyer",
  role: "budget.write",
  table: "buyers",
  matchKey: ["name"],
  dedupeKey: ["name"],
  columns: [
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "تاجر التمور" },
    {
      key: "buyerType",
      labelAr: "النوع",
      type: "enum",
      required: false,
      enumValues: ["cash_customer", "trader", "company"],
      example: "trader",
    },
    { key: "phone", labelAr: "الهاتف", type: "string", required: false, example: "01000000000" },
    { key: "active", labelAr: "نشط", type: "bool", required: false, example: "true" },
  ],
  fromRow: (r) => ({
    name: r.name,
    buyerType: r.buyer_type ?? "",
    phone: r.phone ?? "",
    active: r.active ?? true,
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_org: null,
    p_name: r.name,
    p_buyer_type: r.buyerType || "cash_customer",
    p_phone: r.phone ?? null,
    p_active: r.active ?? true,
  }),
};
