import { describe, it, expect } from "vitest";
import { sectorsDescriptor } from "./sectors";
import { validateRows } from "../validate";
import { buildTemplateSpec, DATA_SHEET } from "../workbook-spec";

describe("sectorsDescriptor", () => {
  it("maps a validated row to the fn_save_sector arg shape", () => {
    const { okRows } = validateRows(sectorsDescriptor, [
      { name: "القطاع الشمالي", code: "S-01", areaFeddan: "12.5", plantingDate: "2020-03-01" },
    ]);
    expect(okRows).toHaveLength(1);
    expect(sectorsDescriptor.toRpcArgs(okRows[0])).toEqual({
      p_id: null,
      p_farm_id: null,
      p_name: "القطاع الشمالي",
      p_code: "S-01",
      p_crop: null,
      p_area_feddan: 12.5,
      p_planting_date: "2020-03-01",
      p_notes: null,
    });
  });

  it("requires name and code", () => {
    const { errors } = validateRows(sectorsDescriptor, [{ name: "", code: "" }]);
    const cols = errors.map((e) => e.column).sort();
    expect(cols).toEqual(["code", "name"]);
  });

  it("produces a template with a data sheet", () => {
    const spec = buildTemplateSpec(sectorsDescriptor);
    expect(spec.sheets.map((s) => s.name)).toContain(DATA_SHEET);
  });
});
