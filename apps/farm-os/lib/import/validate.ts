/**
 * Pure validation / dry-run for the bulk-import framework (spec §6 step 4). Coerces
 * and checks each row against its descriptor's columns. Valid rows are returned in
 * `okRows` ready for the gated RPC; invalid rows produce Arabic `errors`. Writes nothing.
 * Partial success: one bad row never invalidates the good rows.
 */
import type { ImportColumn, ImportDescriptor, DryRunResult, RowError } from "./types";

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
function coerce(col: ImportColumn, raw: unknown): { value: unknown } | { reason: string } {
  const s = typeof raw === "string" ? raw.trim() : raw;
  switch (col.type) {
    case "string":
      return { value: String(s) };
    case "int": {
      if (typeof s === "string" && /^-?\d+$/.test(s)) return { value: Number(s) };
      if (typeof s === "number" && Number.isInteger(s)) return { value: s };
      return { reason: "يجب أن يكون رقمًا صحيحًا" };
    }
    case "decimal": {
      const n = typeof s === "number" ? s : Number(s);
      if (typeof s !== "boolean" && s !== "" && Number.isFinite(n)) return { value: n };
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
    else okRows.push(coerced);
  });

  return { okRows, errors, okCount: okRows.length, errorCount };
}
