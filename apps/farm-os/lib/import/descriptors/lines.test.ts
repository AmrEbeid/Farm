import { describe, it, expect } from "vitest";
import { linesDescriptor } from "./lines";
import { validateRows } from "../validate";

describe("linesDescriptor", () => {
  it("maps a validated + ref-resolved row to the fn_save_line INSERT arg shape when unmatched", () => {
    const row = { hawshaId: "hawsha-uuid", lineNo: 1, lineCode: "L-01", palmCount: 52 };
    expect(linesDescriptor.toRpcArgs(row, null)).toEqual({
      p_id: null, p_hawsha_id: "hawsha-uuid", p_line_no: 1, p_line_code: "L-01",
      p_palm_count: 52, p_direction: null, p_notes: null,
    });
  });

  it("maps to the UPDATE arg shape when matched", () => {
    const row = { hawshaId: "hawsha-uuid", lineNo: 1 };
    expect(linesDescriptor.toRpcArgs(row, "existing-id")).toMatchObject({ p_id: "existing-id" });
  });

  it("coerces numeric columns and requires hawsha code + line number", () => {
    const { okRows, errors } = validateRows(linesDescriptor, [
      { hawshaId: "H-01", lineNo: "1", palmCount: "52" },
      { hawshaId: "", lineNo: "" },
    ]);
    expect(okRows[0]).toMatchObject({ lineNo: 1, palmCount: 52 });
    expect(errors.map((e) => e.column).sort()).toEqual(["hawshaId", "lineNo"]);
  });

  it("declares hawshaId as a ref to hawshat.code, and matchKey as [hawshaId, lineNo]", () => {
    const col = linesDescriptor.columns.find((c) => c.key === "hawshaId");
    expect(col?.ref).toEqual({ table: "hawshat", codeColumn: "code", activeColumn: "archived", activeValue: false });
    expect(linesDescriptor.matchKey).toEqual(["hawshaId", "lineNo"]);
    expect(linesDescriptor.table).toBe("lines");
    expect(linesDescriptor.archiveType).toBe("line");
  });

  it("fromRow maps a DB row back to column-key-shaped values", () => {
    const dbRow = { hawsha_id: "hawsha-uuid", line_no: 1, line_code: null, palm_count: 52, direction: null, notes: null };
    expect(linesDescriptor.fromRow?.(dbRow)).toEqual({
      hawshaId: "hawsha-uuid", lineNo: 1, lineCode: "", palmCount: 52, direction: "", notes: "",
    });
  });
});
