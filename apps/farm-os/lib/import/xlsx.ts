/**
 * Thin `exceljs` adapter for the import framework (spec §7). `exceljs` is loaded with a
 * dynamic `import()` so the heavy library is a lazy async chunk, never in the initial
 * bundle (bundle rule). All structure/mapping logic lives in the pure `workbook-spec.ts`;
 * this module only renders a WorkbookSpec to an .xlsx buffer and reads one back.
 */
import type { ImportDescriptor } from "./types";
import { buildTemplateSpec, parseRows, DATA_SHEET, type WorkbookSpec } from "./workbook-spec";

const DROPDOWN_ROWS = 1000; // rows below the header that get the enum dropdown

/** Render a renderer-agnostic spec to an .xlsx buffer (RTL sheets, enum dropdowns). */
export async function renderWorkbook(spec: WorkbookSpec): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ rightToLeft: true }] });
    for (const row of sheet.rows) ws.addRow(row);
    for (const dd of sheet.dropdowns ?? []) {
      const col = ws.getColumn(dd.col + 1);
      for (let r = 2; r <= DROPDOWN_ROWS + 1; r++) {
        ws.getCell(`${col.letter}${r}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${dd.values.join(",")}"`],
        };
      }
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** Generate the downloadable template for a descriptor. */
export async function generateTemplate(d: ImportDescriptor): Promise<Buffer> {
  return renderWorkbook(buildTemplateSpec(d));
}

/** Parse an uploaded .xlsx buffer into raw row objects (validation is `validateRows`). */
export async function parseUpload(
  buf: Buffer,
  d: ImportDescriptor,
): Promise<Record<string, unknown>[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  // exceljs's Buffer param vs the generic @types/node Buffer differ only structurally.
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.getWorksheet(DATA_SHEET) ?? wb.worksheets[wb.worksheets.length - 1];
  if (!ws) return [];
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cell.value == null ? "" : String(cell.value));
    });
    matrix.push(cells);
  });
  return parseRows(matrix, d);
}
