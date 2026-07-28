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

/** A plain decimal literal and NOTHING else — no leading/trailing space, no second operator. Such a
 *  string is a NUMBER to a spreadsheet, never a formula ("-123.45" evaluates to -123.45; "-1+A1" and
 *  " -1" would not match). Exact decimal amounts are exported as canonical strings without a JS float
 *  conversion (lib/decimal.ts), so they must escape the `-` guard below — otherwise a negative amount
 *  would ship as `'-123.45`, i.e. altered inside a signed annex. Spreadsheet applications may still
 *  apply their own numeric precision on open. */
const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

/** Characters a spreadsheet may STRIP or skip while deciding whether a cell is a formula: every JS
 *  whitespace class (space, tab, CR, LF, FF, VT, NBSP, the Unicode space separators, LS/PS, BOM) plus
 *  the C0/C1 control ranges and the zero-width/bidi format characters that `\s` does not cover. A
 *  formula token hidden behind any of them — "\n=1+1", " =1+1", "​@SUM(A1)" — is still a
 *  formula once the leader is discarded, which is exactly how a naive `^[=+\-@]` guard is bypassed. */
const FORMULA_LEADER = "[\\s\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]";

/** A string cell that a spreadsheet could evaluate: an `= + - @` formula token, optionally hidden
 *  behind any number of stripped/ignored leading characters. */
const FORMULA_CELL = new RegExp(`^${FORMULA_LEADER}*[=+\\-@]`);

/** RFC-4180 cell: quote when the value contains a comma, quote, newline, or edge whitespace.
 *  Formula-injection guard (security-360 MEDIUM-1): a STRING cell that starts with `= + - @` is
 *  executed as a formula by Excel/LibreOffice on open, and stays one when the token is preceded by
 *  whitespace or control characters the application discards first. Neutralize by prefixing a single
 *  quote. Applied to strings ONLY — numbers (incl. negatives like -5) are structurally safe and must
 *  export raw, so a numeric value never gets the quote, and a canonical plain decimal STRING is
 *  likewise exported unaltered. */
function escapeCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s =
    typeof v === "string" && FORMULA_CELL.test(v) && !NUMERIC_LITERAL.test(v) ? "'" + v : String(v);
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
