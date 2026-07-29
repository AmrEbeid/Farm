import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { renderWorkbook, parseUpload, generateTemplate } from "./xlsx";
import { DATA_SHEET, type WorkbookSpec } from "./workbook-spec";
import type { ImportDescriptor } from "./types";

const require = createRequire(import.meta.url);

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

  it("passes existingRows through to buildTemplateSpec so the data sheet is pre-filled", async () => {
    const buf = await generateTemplate(d, [{ name: "أحمد", kind: "a" }]);
    const parsed = await parseUpload(buf, d);
    expect(parsed).toEqual([{ name: "أحمد", kind: "a" }]);
  });

  it("writes conditional formatting with the overridden uuid runtime", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("uuid");
    ws.getCell("A1").value = 1;
    ws.addConditionalFormatting({
      ref: "A1",
      rules: [
        {
          type: "dataBar",
          priority: 1,
          gradient: false,
          cfvo: [{ type: "min" }, { type: "max" }],
        },
      ],
    });

    const out = await wb.xlsx.writeBuffer();
    const exceljsPath = require.resolve("exceljs");
    const uuidPackagePath = require.resolve("uuid/package.json", { paths: [exceljsPath] });
    const uuidPackage = require(uuidPackagePath) as { version: string };
    expect(uuidPackage.version).toBe("11.1.1");

    const jszipPath = require.resolve("jszip", { paths: [exceljsPath] });
    const JSZip = require(jszipPath) as {
      loadAsync(data: unknown): Promise<{
        file(path: string): { async(type: "string"): Promise<string> } | null;
      }>;
    };
    const zip = await JSZip.loadAsync(out);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    const x14Id = sheetXml?.match(/<x14:cfRule[^>]+id="(\{[^"]+\})"/)?.[1];
    expect(x14Id).toMatch(/^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/);
  });
});
