import { describe, it, expect } from "vitest";
import { sectorsDescriptor } from "./sectors";
import { validateRows } from "../validate";
import { buildTemplateSpec, DATA_SHEET } from "../workbook-spec";

describe("sectorsDescriptor", () => {
  it("maps a validated + ref-resolved row to the fn_save_sector arg shape", () => {
    // farmId arrives already resolved to an id (resolveRefs runs before toRpcArgs).
    const row = { farmId: "farm-uuid", name: "القطاع الشمالي", code: "S-01", areaFeddan: 12.5, plantingDate: "2020-03-01" };
    expect(sectorsDescriptor.toRpcArgs(row)).toEqual({
      p_id: null,
      p_farm_id: "farm-uuid",
      p_name: "القطاع الشمالي",
      p_code: "S-01",
      p_crop: null,
      p_area_feddan: 12.5,
      p_planting_date: "2020-03-01",
      p_notes: null,
    });
  });

  it("requires the farm code, name and code", () => {
    const { errors } = validateRows(sectorsDescriptor, [{ farmId: "", name: "", code: "" }]);
    const cols = errors.map((e) => e.column).sort();
    expect(cols).toEqual(["code", "farmId", "name"]);
  });

  it("declares farmId as a ref to farms.code", () => {
    const farmCol = sectorsDescriptor.columns.find((c) => c.key === "farmId");
    expect(farmCol?.ref).toEqual({ table: "farms", codeColumn: "code" });
  });

  it("produces a template with a data sheet", () => {
    const spec = buildTemplateSpec(sectorsDescriptor);
    expect(spec.sheets.map((s) => s.name)).toContain(DATA_SHEET);
  });
});
