import { describe, expect, it } from "vitest";
import { rowsToCsv, type CsvColumn } from "./export-csv";

const cols: CsvColumn[] = [
  { id: "code", header: "الرمز" },
  { id: "qty", header: "الكمية" },
  { id: "note", header: "ملاحظة" },
];

describe("rowsToCsv", () => {
  it("emits a UTF-8 BOM (Excel renders Arabic) + header even with no rows", () => {
    const csv = rowsToCsv([], cols);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿" + "الرمز,الكمية,ملاحظة");
  });

  it("serializes rows by column id, raw values, CRLF-separated", () => {
    const csv = rowsToCsv([{ code: "PR-1", qty: 500, note: "تسميد" }], cols);
    expect(csv).toBe("﻿" + "الرمز,الكمية,ملاحظة\r\nPR-1,500,تسميد");
  });

  it("RFC-4180-escapes commas, quotes, and newlines", () => {
    const csv = rowsToCsv(
      [{ code: 'a,b', qty: 'say "hi"', note: "line1\nline2" }],
      cols,
    );
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it("renders null/undefined/missing as empty cells", () => {
    const csv = rowsToCsv([{ code: "x", qty: null }], cols); // note missing entirely
    expect(csv.endsWith("x,,")).toBe(true);
  });

  it("neutralizes spreadsheet formula injection in string cells (leading = + - @)", () => {
    const csv = rowsToCsv([{ code: "=1+1", qty: "+cmd|'/c calc'!A1", note: "@SUM(A1)" }], cols);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+cmd|'/c calc'!A1");
    expect(csv).toContain("'@SUM(A1)");
  });

  it("exports negative NUMBERS raw (a number is not treated as a formula)", () => {
    const csv = rowsToCsv([{ code: "x", qty: -5 }], cols);
    expect(csv).toContain("x,-5");
  });

  it("exports an exact decimal STRING raw — a plain numeric literal is never a formula", () => {
    // Exact accounting amounts are exported as strings to keep every digit; the `-` guard must not
    // alter one (lib/decimal.ts). Anything that only starts like a number still gets neutralized.
    const csv = rowsToCsv([{ code: "-123.45", qty: "-0.5", note: "-1+A1" }], cols);
    expect(csv).toContain("-123.45,-0.5,'-1+A1");
  });

  it("neutralizes a formula hidden behind whitespace, newlines, or control characters", () => {
    // Excel/LibreOffice discard or skip these leaders before deciding a cell is a formula, so a guard
    // that only inspects index 0 is bypassed by one leading space — or one leading LF.
    // The invisible code points are written as escapes on purpose: a literal NUL or bidi-override
    // character in a source file is its own hazard, and an escape names exactly what is pinned.
    const hidden = [
      " =1+1",
      "\n=1+1",
      "\r\n=cmd|'/c calc'!A1",
      "\t\t+1+1",
      " @SUM(A1)",
      "\u200b=1+1", // zero-width space
      "\u00a0=1+1", // non-breaking space
      "\u0000=1+1", // NUL
      "\ufeff-1+A1", // byte-order mark
      "\u202e=1+1", // right-to-left override
      "\u2028@SUM(A1)", // line separator
      "\u0001\u001f=1+1", // C0 controls
      "   \t\n  =HYPERLINK(0)",
    ];
    for (const value of hidden) {
      // The single quote sits immediately before the ORIGINAL value, leader and all: nothing of the
      // cell is dropped, and Excel reads the whole thing as text.
      expect(rowsToCsv([{ code: value }], cols)).toContain(`'${value}`);
    }
  });

  it("still exports a canonical decimal untouched, however the guard is widened", () => {
    // The widened leader class must not start quoting amounts: a canonical decimal has no leader.
    for (const amount of ["0", "-0.01", "12345678901234567890.12", "-70"]) {
      expect(rowsToCsv([{ code: amount }], cols)).toContain(`\r\n${amount},,`);
    }
    // …but a decimal with a leading space is NOT canonical, so it is treated as untrusted text.
    expect(rowsToCsv([{ code: " -1.5" }], cols)).toContain("\r\n' -1.5,,");
  });
});
