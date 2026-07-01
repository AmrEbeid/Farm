/**
 * Import descriptor for hawsha lines (خطوط). Writes through `fn_save_line` (gate:
 * structure.write, enforced in the DB). The parent hawsha is given by its CODE, resolved
 * to hawsha_id via the ref lookup (RLS-scoped). matchKey is [hawshaId, lineNo] rather than
 * lineCode — line_code is optional/nullable so it can't anchor a match, but line_no is
 * required and stable (SPEC-0020).
 */
import type { ImportDescriptor } from "../types";

export const linesDescriptor: ImportDescriptor = {
  key: "lines",
  titleAr: "الخطوط",
  rpc: "fn_save_line",
  role: "structure.write",
  table: "lines",
  archiveType: "line",
  matchKey: ["hawshaId", "lineNo"],
  // Same key as matchKey: two rows sharing (hawshaId, lineNo) in one upload must not both
  // resolve to the same existing id (planCommit would then fire two RPC calls with the
  // identical p_id).
  dedupeKey: ["hawshaId", "lineNo"],
  columns: [
    { key: "hawshaId", labelAr: "كود الحوش", type: "string", required: true, example: "H-01", ref: { table: "hawshat", codeColumn: "code", activeColumn: "archived", activeValue: false } },
    { key: "lineNo", labelAr: "رقم الخط", type: "int", required: true, example: "1" },
    { key: "lineCode", labelAr: "كود الخط", type: "string", required: false, example: "" },
    { key: "palmCount", labelAr: "عدد النخيل", type: "int", required: false, example: "52" },
    { key: "direction", labelAr: "الاتجاه", type: "string", required: false, example: "" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
  ],
  fromRow: (r) => ({
    hawshaId: r.hawsha_id,
    lineNo: r.line_no,
    lineCode: r.line_code ?? "",
    palmCount: r.palm_count ?? "",
    direction: r.direction ?? "",
    notes: r.notes ?? "",
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_hawsha_id: r.hawshaId,
    p_line_no: r.lineNo,
    p_line_code: r.lineCode || null,
    p_palm_count: r.palmCount ?? null,
    p_direction: r.direction || null,
    p_notes: r.notes ?? null,
  }),
};
