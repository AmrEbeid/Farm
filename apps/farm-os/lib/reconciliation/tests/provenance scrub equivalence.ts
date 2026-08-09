import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { CANONICAL_WORKBOOK_PATH, canonicalGateEnabled } from "../canonical fixtures";
import { EXPECTED_WORKBOOK_SHA256 } from "../pinned hashes.mts";

const KNOWLEDGE_DB_PATH =
  "/Users/amrebeid/Documents/Farm Records Knowledge System/knowledge.sqlite";
const PRE_SCRUB_WORKBOOK_SHA256 =
  "9728167b7860b18ff802dda85fe01897a2c645c4fc21677c22dfeaead2f71dc3";
const APPROVED_REMOVALS = new Set(["العاملين!D1", "العاملين!E2"]);

interface ExtractedCell {
  sheet: string;
  cell: string;
  formula: string | null;
  stored_value: string | null;
}

function key(sheet: string, cell: string): string {
  return `${sheet}!${cell}`;
}

function normalizedCurrentValue(cell: ExcelJS.Cell): string {
  const value = cell.formula ? cell.result : cell.value;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  if (value && typeof value === "object") {
    if ("error" in value) return String(value.error);
    if ("text" in value) return String(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }
  return String(value);
}

describe.runIf(canonicalGateEnabled())("credential scrub semantic equivalence", () => {
  it("changes only the two approved credential cells", async () => {
    const workbookBytes = readFileSync(CANONICAL_WORKBOOK_PATH);
    expect(createHash("sha256").update(workbookBytes).digest("hex")).toBe(
      EXPECTED_WORKBOOK_SHA256,
    );

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(KNOWLEDGE_DB_PATH, { readOnly: true });
    const extracted = database
      .prepare(
        `select sheet, cell, formula, stored_value
           from content_units
          where sha256 = ? and unit_type = 'cell'`,
      )
      .all(PRE_SCRUB_WORKBOOK_SHA256) as unknown as ExtractedCell[];
    database.close();

    expect(extracted).toHaveLength(149_595);
    const before = new Map(extracted.map((row) => [key(row.sheet, row.cell), row]));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(CANONICAL_WORKBOOK_PATH);
    const after = new Map<string, ExcelJS.Cell>();
    let mergedAliases = 0;

    for (const worksheet of workbook.worksheets) {
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (cell.value == null) return;
          if (cell.isMerged && cell.master.address !== cell.address) {
            mergedAliases += 1;
            return;
          }
          after.set(key(worksheet.name, cell.address), cell);
        });
      });
    }

    expect(mergedAliases).toBe(128);
    expect([...after.keys()].filter((cellKey) => !before.has(cellKey))).toEqual([]);
    expect([...before.keys()].filter((cellKey) => !after.has(cellKey))).toEqual(
      [...APPROVED_REMOVALS],
    );

    let compared = 0;
    let redactedFormulaResults = 0;
    let missingFormulaResults = 0;
    for (const [cellKey, oldCell] of before) {
      if (APPROVED_REMOVALS.has(cellKey)) continue;
      const currentCell = after.get(cellKey);
      expect(currentCell, cellKey).toBeDefined();

      const currentFormula = currentCell?.formula ? `=${currentCell.formula}` : null;
      expect(currentFormula === oldCell.formula, `${cellKey} formula`).toBe(true);

      if (oldCell.stored_value == null) {
        expect(currentFormula, `${cellKey} missing cached result requires a formula`).not.toBeNull();
        missingFormulaResults += 1;
        compared += 1;
        continue;
      }
      if (oldCell.stored_value.includes("[REDACTED:")) {
        expect(currentFormula, `${cellKey} redacted cached result requires a formula`).not.toBeNull();
        redactedFormulaResults += 1;
        compared += 1;
        continue;
      }

      const currentValue = normalizedCurrentValue(currentCell as ExcelJS.Cell);
      if (typeof currentCell?.result === "number") {
        expect(
          Number(currentValue) === Number(oldCell.stored_value),
          `${cellKey} numeric result`,
        ).toBe(true);
      } else {
        expect(currentValue === oldCell.stored_value, `${cellKey} value`).toBe(true);
      }
      compared += 1;
    }

    expect(compared).toBe(149_593);
    expect(redactedFormulaResults).toBe(13);
    expect(missingFormulaResults).toBe(25);
  }, 15_000);
});
