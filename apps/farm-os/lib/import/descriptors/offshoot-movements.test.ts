import { describe, expect, it } from "vitest";
import { offshootMovementsDescriptor } from "./offshoot-movements";
import { validateRows } from "../validate";

describe("offshootMovementsDescriptor", () => {
  it("maps a validated + ref-resolved row to fn_record_offshoot_movement args", () => {
    expect(
      offshootMovementsDescriptor.toRpcArgs({
        movementDate: "2026-07-04",
        movementType: "plant",
        qty: 50,
        sourceCostCenterId: "src-id",
        destCostCenterId: "dest-id",
        note: "دفعة يوليو",
      }),
    ).toEqual({
      p_org: null,
      p_movement_type: "plant",
      p_qty: 50,
      p_movement_date: "2026-07-04",
      p_source_cost_center_id: "src-id",
      p_dest_cost_center_id: "dest-id",
      p_note: "دفعة يوليو",
    });
  });

  it("validates movement type, quantity, and optional ISO date", () => {
    const { okRows, errors } = validateRows(offshootMovementsDescriptor, [
      { movementDate: "2026-07-04", movementType: "sell", qty: "12" },
      { movementDate: "04-07-2026", movementType: "bad", qty: "" },
    ]);

    expect(okRows[0]).toMatchObject({ movementDate: "2026-07-04", movementType: "sell", qty: 12 });
    expect(errors).toEqual([
      { row: 2, column: "movementDate", reason: "يجب أن يكون التاريخ بصيغة YYYY-MM-DD" },
      { row: 2, column: "movementType", reason: "قيمة غير مسموح بها" },
      { row: 2, column: "qty", reason: "حقل مطلوب" },
    ]);
  });

  it("declares cost-center refs for source and destination codes", () => {
    const source = offshootMovementsDescriptor.columns.find((c) => c.key === "sourceCostCenterId");
    const dest = offshootMovementsDescriptor.columns.find((c) => c.key === "destCostCenterId");
    expect(source?.ref).toEqual({ table: "cost_centers", codeColumn: "code", activeColumn: "active", activeValue: true });
    expect(dest?.ref).toEqual(source?.ref);
  });
});
