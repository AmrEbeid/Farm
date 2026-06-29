// SPEC-0017 slice 1 — "every table extractable". Pure CSV serialization (no DOM, so it's unit-testable);
// the DOM download lives in components/ExportButton.tsx. Designed to take the same {id,header} columns +
// row objects that SimpleTable already uses, so any table page gets export with one line.
//
// Arabic-RTL note: the output is prefixed with a UTF-8 BOM so Excel opens Arabic text correctly. Values
// are exported RAW (numbers as-is) for spreadsheet use — formatting (num/pct/fmtDate) is presentation.

export interface CsvColumn {
  id: string;
  header: string;
}
export type CsvRow = Record<string, string | number | null | undefined>;

/** RFC-4180 cell: quote when the value contains a comma, quote, newline, or edge whitespace. */
function escapeCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s) || s !== s.trim()) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Serialize rows → CSV (CRLF line endings, RFC-4180), prefixed with a UTF-8 BOM for Excel/Arabic. */
export function rowsToCsv(rows: CsvRow[], columns: CsvColumn[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(",");
  if (rows.length === 0) return "﻿" + head;
  const body = rows
    .map((r) => columns.map((c) => escapeCell(r[c.id])).join(","))
    .join("\r\n");
  return "﻿" + head + "\r\n" + body;
}
