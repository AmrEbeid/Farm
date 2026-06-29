import { describe, it, expect } from "vitest";
import { buildTemplateSpec, parseRows, DATA_SHEET } from "./workbook-spec";
import type { ImportDescriptor } from "./types";

const d: ImportDescriptor = {
  key: "sample",
  titleAr: "عينة",
  rpc: "fn_x",
  role: "owner",
  columns: [
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "أحمد" },
    { key: "kind", labelAr: "النوع", type: "enum", required: false, enumValues: ["a", "b"], example: "a" },
  ],
  toRpcArgs: (r) => r,
};

describe("buildTemplateSpec", () => {
  it("produces an instructions sheet and a header-only data sheet", () => {
    const spec = buildTemplateSpec(d);
    expect(spec.sheets.map((s) => s.name)).toEqual(["التعليمات", DATA_SHEET]);
    const data = spec.sheets[1];
    expect(data.rows).toHaveLength(1); // header only — no example row to import
    expect(data.rows[0]).toEqual(["الاسم *", "النوع"]); // required gets a *
  });

  it("emits a dropdown for the enum column at its data-sheet index", () => {
    const data = buildTemplateSpec(d).sheets[1];
    expect(data.dropdowns).toEqual([{ col: 1, values: ["a", "b"] }]);
  });

  it("sanitizes a formula-triggering example value", () => {
    const evil: ImportDescriptor = {
      ...d,
      columns: [{ key: "x", labelAr: "س", type: "string", required: false, example: "=HYPERLINK(1)" }],
    };
    const instr = buildTemplateSpec(evil).sheets[0].rows;
    const exampleCell = instr[instr.length - 1].at(-1);
    expect(exampleCell).toBe("'=HYPERLINK(1)");
  });
});

describe("parseRows", () => {
  it("maps data rows to objects keyed by column key, matching Arabic headers", () => {
    const matrix = [
      ["الاسم *", "النوع"],
      ["أحمد", "a"],
      ["سعد", "b"],
    ];
    expect(parseRows(matrix, d)).toEqual([
      { name: "أحمد", kind: "a" },
      { name: "سعد", kind: "b" },
    ]);
  });

  it("skips fully blank rows", () => {
    const matrix = [["الاسم *", "النوع"], ["", ""], ["أحمد", "a"]];
    expect(parseRows(matrix, d)).toEqual([{ name: "أحمد", kind: "a" }]);
  });

  it("falls back to the column key when a label header is absent", () => {
    const matrix = [["name", "kind"], ["أحمد", "a"]];
    expect(parseRows(matrix, d)).toEqual([{ name: "أحمد", kind: "a" }]);
  });
});
