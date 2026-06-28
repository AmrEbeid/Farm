/**
 * Pure template structure + row-mapping for the import framework (spec §7). Builds a
 * renderer-agnostic `WorkbookSpec` from a descriptor (instructions + data sheets, enum
 * dropdowns, sanitized cells) and maps a parsed cell matrix back to row objects. No
 * `exceljs` here — the thin rendering/parsing adapter lives in `xlsx.ts`.
 */
import { sanitizeCell } from "./sanitize";
import type { ImportDescriptor } from "./types";

export interface SheetSpec {
  name: string;
  rows: string[][]; // every cell already sanitized
  dropdowns?: { col: number; values: string[] }[]; // 0-based data-sheet column
}

export interface WorkbookSpec {
  sheets: SheetSpec[];
}

export const DATA_SHEET = "البيانات";
const INSTRUCTIONS_SHEET = "التعليمات";
const DATE_HINT = "YYYY-MM-DD";

/** Strip the sanitize guard quote and the required-marker, for header matching. */
function normHeader(s: string): string {
  return s.replace(/^'/, "").trim().replace(/\s*\*\s*$/, "");
}

/** Build the renderer-agnostic template for a descriptor. The data sheet is header-only
 * (the worked example lives on the instructions sheet, so it is never imported). */
export function buildTemplateSpec(d: ImportDescriptor): WorkbookSpec {
  const instructions: string[][] = [
    [sanitizeCell(d.titleAr)],
    [sanitizeCell("الأعمدة المطلوبة معلّمة بنجمة (*). صيغة التاريخ: " + DATE_HINT)],
    [],
    [
      sanitizeCell("العمود"),
      sanitizeCell("النوع"),
      sanitizeCell("مطلوب؟"),
      sanitizeCell("القيم المسموحة"),
      sanitizeCell("مثال"),
    ],
    ...d.columns.map((c) => [
      sanitizeCell(c.labelAr),
      sanitizeCell(c.type),
      sanitizeCell(c.required ? "نعم" : "لا"),
      sanitizeCell((c.enumValues ?? []).join(" / ")),
      sanitizeCell(c.example),
    ]),
  ];

  const header = d.columns.map((c) => sanitizeCell(c.required ? c.labelAr + " *" : c.labelAr));

  const dropdowns = d.columns
    .map((c, i) => (c.type === "enum" ? { col: i, values: c.enumValues ?? [] } : null))
    .filter((x): x is { col: number; values: string[] } => x !== null);

  return {
    sheets: [
      { name: INSTRUCTIONS_SHEET, rows: instructions },
      { name: DATA_SHEET, rows: [header], dropdowns },
    ],
  };
}

/** Map a raw cell matrix (row 0 = headers) to row objects keyed by column key. Matches
 * headers by Arabic label (required-marker stripped), falling back to the column key.
 * Blank rows are skipped. Returns raw string cells; validation/coercion is `validateRows`. */
export function parseRows(
  matrix: string[][],
  d: ImportDescriptor,
): Record<string, unknown>[] {
  if (matrix.length === 0) return [];
  const headers = matrix[0].map(normHeader);

  const colIndex = new Map<string, number>();
  for (const c of d.columns) {
    let idx = headers.indexOf(normHeader(c.labelAr));
    if (idx === -1) idx = headers.indexOf(c.key);
    if (idx !== -1) colIndex.set(c.key, idx);
  }

  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r] ?? [];
    if (cells.every((x) => x == null || String(x).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    for (const c of d.columns) {
      const idx = colIndex.get(c.key);
      obj[c.key] = idx == null ? "" : (cells[idx] ?? "");
    }
    rows.push(obj);
  }
  return rows;
}
