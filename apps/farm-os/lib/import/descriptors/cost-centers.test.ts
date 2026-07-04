import { describe, it, expect } from "vitest";
import { costCentersDescriptor } from "./cost-centers";
import { validateRows } from "../validate";
import { buildTemplateSpec, DATA_SHEET } from "../workbook-spec";

describe("costCentersDescriptor", () => {
  it("maps a validated + ref-resolved row to the fn_save_cost_center INSERT arg shape", () => {
    const row = {
      parentId: "parent-uuid",
      code: "CC-HSW-PALM",
      nameAr: "نخيل الحصوه",
      sectorId: "sector-uuid",
      enterprise: "نخيل",
      areaFeddan: 14,
      sortOrder: 12,
      active: true,
    };
    expect(costCentersDescriptor.toRpcArgs(row, null)).toEqual({
      p_id: null,
      p_org: null,
      p_parent_id: "parent-uuid",
      p_code: "CC-HSW-PALM",
      p_name_ar: "نخيل الحصوه",
      p_sector_id: "sector-uuid",
      p_enterprise: "نخيل",
      p_area_feddan: 14,
      p_sort_order: 12,
      p_active: true,
    });
  });

  it("maps to the fn_save_cost_center UPDATE arg shape when matched", () => {
    const row = { code: "CC-HSW", nameAr: "الحصوه", areaFeddan: 30 };
    expect(costCentersDescriptor.toRpcArgs(row, "existing-id")).toMatchObject({
      p_id: "existing-id",
      p_parent_id: null,
      p_code: "CC-HSW",
      p_name_ar: "الحصوه",
      p_sector_id: null,
      p_area_feddan: 30,
      p_active: true,
    });
  });

  it("validates required fields and coerces numeric/bool columns", () => {
    const { okRows, errors } = validateRows(costCentersDescriptor, [
      { parentId: "CC-HSW", code: "CC-HSW-PALM", nameAr: "نخيل الحصوه", sectorId: "HSW", areaFeddan: "14", sortOrder: "12", active: "true" },
      { code: "", nameAr: "" },
    ]);
    expect(okRows[0]).toMatchObject({ areaFeddan: 14, sortOrder: 12, active: true });
    expect(errors).toEqual([
      { row: 2, column: "code", reason: "حقل مطلوب" },
      { row: 2, column: "nameAr", reason: "حقل مطلوب" },
    ]);
  });

  it("declares parent and sector refs for code-based imports", () => {
    const parent = costCentersDescriptor.columns.find((c) => c.key === "parentId");
    const sector = costCentersDescriptor.columns.find((c) => c.key === "sectorId");
    expect(parent?.ref).toEqual({ table: "cost_centers", codeColumn: "code", activeColumn: "active", activeValue: true });
    expect(sector?.ref).toEqual({ table: "sectors", codeColumn: "code", activeColumn: "archived", activeValue: false });
  });

  it("produces a template with a data sheet", () => {
    const spec = buildTemplateSpec(costCentersDescriptor);
    expect(spec.sheets.map((s) => s.name)).toContain(DATA_SHEET);
  });

  it("declares table, matchKey, and a matching dedupeKey for reconcile-upsert", () => {
    expect(costCentersDescriptor.table).toBe("cost_centers");
    expect(costCentersDescriptor.matchKey).toEqual(["code"]);
    expect(costCentersDescriptor.dedupeKey).toEqual(costCentersDescriptor.matchKey);
  });

  it("fromRow maps a DB row back to column-key-shaped values", () => {
    const dbRow = {
      parent_id: "parent-uuid",
      code: "CC-HSW-PALM",
      name_ar: "نخيل الحصوه",
      sector_id: "sector-uuid",
      enterprise: "نخيل",
      area_feddan: 14,
      sort_order: 12,
      active: true,
    };
    expect(costCentersDescriptor.fromRow?.(dbRow)).toEqual({
      parentId: "parent-uuid",
      code: "CC-HSW-PALM",
      nameAr: "نخيل الحصوه",
      sectorId: "sector-uuid",
      enterprise: "نخيل",
      areaFeddan: 14,
      sortOrder: 12,
      active: true,
    });
  });
});
