import { describe, it, expect } from "vitest";
import { renderWorkbook, parseUpload, generateTemplate } from "./xlsx";
import { DATA_SHEET, type WorkbookSpec } from "./workbook-spec";
import type { ImportDescriptor } from "./types";

const d: ImportDescriptor = {
  key: "sample",
  titleAr: "عينة",
  rpc: "fn_x",
  role: "owner",
  columns: [
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "أحمد" },
    { key: "kind", labelAr: "النوع", type: "enum", required: true, enumValues: ["a", "b"], example: "a" },
  ],
  toRpcArgs: (r) => r,
};

describe("xlsx adapter", () => {
  it("generateTemplate returns a non-empty .xlsx (zip) buffer", async () => {
    const buf = await generateTemplate(d);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK"); // .xlsx is a zip
  });

  it("round-trips a data sheet through render + parse", async () => {
    const spec: WorkbookSpec = {
      sheets: [
        { name: DATA_SHEET, rows: [["الاسم *", "النوع *"], ["أحمد", "a"], ["سعد", "b"]] },
      ],
    };
    const buf = await renderWorkbook(spec);
    const rows = await parseUpload(buf, d);
    expect(rows).toEqual([
      { name: "أحمد", kind: "a" },
      { name: "سعد", kind: "b" },
    ]);
  });
});
