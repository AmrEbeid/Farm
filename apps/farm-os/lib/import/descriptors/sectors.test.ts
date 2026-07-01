import { describe, it, expect } from "vitest";
import { sectorsDescriptor } from "./sectors";
import { validateRows } from "../validate";
import { buildTemplateSpec, DATA_SHEET } from "../workbook-spec";

describe("sectorsDescriptor", () => {
  it("maps a validated + ref-resolved row to the fn_save_sector INSERT arg shape when unmatched", () => {
    const row = { farmId: "farm-uuid", name: "القطاع الشمالي", code: "S-01", areaFeddan: 12.5 };
    expect(sectorsDescriptor.toRpcArgs(row, null)).toMatchObject({ p_id: null, p_code: "S-01" });
  });

  it("maps to the fn_save_sector UPDATE arg shape when matched", () => {
    const row = { farmId: "farm-uuid", name: "القطاع الشمالي", code: "S-01", areaFeddan: 12.5 };
    expect(sectorsDescriptor.toRpcArgs(row, "existing-id")).toMatchObject({ p_id: "existing-id" });
  });

  it("requires the farm code, name and code", () => {
    const { errors } = validateRows(sectorsDescriptor, [{ farmId: "", name: "", code: "" }]);
    const cols = errors.map((e) => e.column).sort();
    expect(cols).toEqual(["code", "farmId", "name"]);
  });

  it("declares farmId as a ref to farms.code", () => {
    const farmCol = sectorsDescriptor.columns.find((c) => c.key === "farmId");
    expect(farmCol?.ref).toEqual({ table: "farms", codeColumn: "code", activeColumn: "archived", activeValue: false });
  });

  it("produces a template with a data sheet", () => {
    const spec = buildTemplateSpec(sectorsDescriptor);
    expect(spec.sheets.map((s) => s.name)).toContain(DATA_SHEET);
  });

  it("declares table, archiveType, and matchKey for reconcile-upsert", () => {
    expect(sectorsDescriptor.table).toBe("sectors");
    expect(sectorsDescriptor.archiveType).toBe("sector");
    expect(sectorsDescriptor.matchKey).toEqual(["code"]);
  });

  it("fromRow maps a DB row back to column-key-shaped values (ref column still holds the id)", () => {
    const dbRow = { farm_id: "farm-uuid", name: "القطاع الشمالي", code: "S-01", crop: null, area_feddan: 12.5, planting_date: null, notes: null };
    expect(sectorsDescriptor.fromRow?.(dbRow)).toEqual({
      farmId: "farm-uuid", name: "القطاع الشمالي", code: "S-01", crop: "", areaFeddan: 12.5, plantingDate: "", notes: "",
    });
  });
});
