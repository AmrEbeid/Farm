import { describe, it, expect } from "vitest";
import { hawshatDescriptor } from "./hawshat";
import { validateRows } from "../validate";

describe("hawshatDescriptor", () => {
  it("maps a validated + ref-resolved row to the fn_save_hawsha INSERT arg shape when unmatched", () => {
    const row = { sectorId: "sector-uuid", name: "الحوش 1", code: "H-01", areaQirat: 6, rowCount: 10, palmCountBarhi: 120 };
    expect(hawshatDescriptor.toRpcArgs(row, null)).toEqual({
      p_id: null,
      p_sector_id: "sector-uuid",
      p_name: "الحوش 1",
      p_code: "H-01",
      p_area_qirat: 6,
      p_row_count: 10,
      p_palm_count_barhi: 120,
      p_palm_count_male: null,
      p_planting_date: null,
      p_notes: null,
    });
  });

  it("maps to the fn_save_hawsha UPDATE arg shape when matched", () => {
    const row = { sectorId: "sector-uuid", name: "الحوش 1", code: "H-01", areaQirat: 6, rowCount: 10, palmCountBarhi: 120 };
    expect(hawshatDescriptor.toRpcArgs(row, "existing-id")).toEqual({
      p_id: "existing-id",
      p_sector_id: "sector-uuid",
      p_name: "الحوش 1",
      p_code: "H-01",
      p_area_qirat: 6,
      p_row_count: 10,
      p_palm_count_barhi: 120,
      p_palm_count_male: null,
      p_planting_date: null,
      p_notes: null,
    });
  });

  it("coerces numeric columns and requires sector code, name, code", () => {
    const { okRows, errors } = validateRows(hawshatDescriptor, [
      { sectorId: "S-01", name: "الحوش 1", code: "H-01", rowCount: "10", palmCountBarhi: "120" },
      { sectorId: "", name: "", code: "" },
    ]);
    expect(okRows[0]).toMatchObject({ rowCount: 10, palmCountBarhi: 120 });
    expect(errors.map((e) => e.column).sort()).toEqual(["code", "name", "sectorId"]);
  });

  it("declares sectorId as a ref to sectors.code", () => {
    const col = hawshatDescriptor.columns.find((c) => c.key === "sectorId");
    expect(col?.ref).toEqual({ table: "sectors", codeColumn: "code", activeColumn: "archived", activeValue: false });
  });

  it("declares table, archiveType, matchKey, and a matching dedupeKey for reconcile-upsert", () => {
    expect(hawshatDescriptor.table).toBe("hawshat");
    expect(hawshatDescriptor.archiveType).toBe("hawsha");
    expect(hawshatDescriptor.matchKey).toEqual(["code"]);
    // dedupeKey must mirror matchKey — otherwise two uploaded rows sharing a code would both
    // resolve to the same existing id and fire duplicate RPC calls (see commit-plan.ts).
    expect(hawshatDescriptor.dedupeKey).toEqual(hawshatDescriptor.matchKey);
  });

  it("fromRow maps a DB row back to column-key-shaped values (ref column still holds the id)", () => {
    const dbRow = {
      sector_id: "sector-uuid",
      name: "الحوش 1",
      code: "H-01",
      area_qirat: 6,
      row_count: 10,
      palm_count_barhi: 120,
      palm_count_male: null,
      planting_date: null,
      notes: null,
    };
    expect(hawshatDescriptor.fromRow?.(dbRow)).toEqual({
      sectorId: "sector-uuid",
      name: "الحوش 1",
      code: "H-01",
      areaQirat: 6,
      rowCount: 10,
      palmCountBarhi: 120,
      palmCountMale: "",
      plantingDate: "",
      notes: "",
    });
  });
});
