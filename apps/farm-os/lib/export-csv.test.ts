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
});
