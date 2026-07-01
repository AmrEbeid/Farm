/**
 * Pure validation / dry-run for the bulk-import framework (spec §6 step 4). Coerces
 * and checks each row against its descriptor's columns. Valid rows are returned in
 * `okRows` ready for the gated RPC; invalid rows produce Arabic `errors`. Writes nothing.
 * Partial success: one bad row never invalidates the good rows.
 */
import { setSourceRow, type ImportColumn, type ImportDescriptor, type DryRunResult, type RowError } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [year, month, day] = s.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Coerce one cell. Returns { value } on success or { reason } (Arabic) on failure. */
// Arabic-Indic (٠–٩ U+0660–0669) + Extended-Arabic (۰–۹ U+06F0–06F9) digits → ASCII, so numeric cells
// typed in Arabic digits parse (Arabic-RTL-first). Applied ONLY to numeric columns — never to string
// columns, where Arabic digits in a name/code must be preserved verbatim.
function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function coerce(col: ImportColumn, raw: unknown): { value: unknown } | { reason: string } {
  const s = typeof raw === "string" ? raw.trim() : raw;
  switch (col.type) {
    case "string":
      return { value: String(s) };
    case "int": {
      const t = typeof s === "string" ? normalizeDigits(s) : s;
      if (typeof t === "string" && /^-?\d+$/.test(t)) return { value: Number(t) };
      if (typeof s === "number" && Number.isInteger(s)) return { value: s };
      return { reason: "يجب أن يكون رقمًا صحيحًا" };
    }
    case "decimal": {
      const t = typeof s === "string" ? normalizeDigits(s) : s;
      const n = typeof t === "number" ? t : Number(t);
      if (typeof t !== "boolean" && t !== "" && Number.isFinite(n)) return { value: n };
      return { reason: "يجب أن يكون رقمًا" };
    }
    case "bool": {
      if (s === true || s === "true" || s === 1 || s === "1") return { value: true };
      if (s === false || s === "false" || s === 0 || s === "0") return { value: false };
      return { reason: "يجب أن يكون صح/خطأ" };
    }
    case "date": {
      if (typeof s === "string" && isValidIsoDate(s)) return { value: s };
      return { reason: "يجب أن يكون التاريخ بصيغة YYYY-MM-DD" };
    }
    case "enum": {
      if (typeof s === "string" && (col.enumValues ?? []).includes(s)) return { value: s };
      return { reason: "قيمة غير مسموح بها" };
    }
  }
}

export function validateRows(
  descriptor: ImportDescriptor,
  rows: Record<string, unknown>[],
): DryRunResult {
  const okRows: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  let errorCount = 0;

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const coerced: Record<string, unknown> = {};
    let rowHasError = false;

    for (const col of descriptor.columns) {
      const raw = row[col.key];
      if (isEmpty(raw)) {
        if (col.required) {
          errors.push({ row: rowNum, column: col.key, reason: "حقل مطلوب" });
          rowHasError = true;
        }
        continue;
      }
      const result = coerce(col, raw);
      if ("reason" in result) {
        errors.push({ row: rowNum, column: col.key, reason: result.reason });
        rowHasError = true;
      } else {
        coerced[col.key] = result.value;
      }
    }

    if (rowHasError) errorCount += 1;
    else okRows.push(setSourceRow(coerced, rowNum));
  });

  return { okRows, errors, okCount: okRows.length, errorCount };
}
