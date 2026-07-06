import { describe, expect, it } from "vitest";
import { materialActualQtyForRequirement } from "./pva-materials";

describe("materialActualQtyForRequirement", () => {
  it("matches duplicate item rows by requirement id", () => {
    const actuals = [
      { requirement_id: "req-a", item_id: "item-1", actual_qty: 5 },
      { requirement_id: "req-b", item_id: "item-1", actual_qty: 20 },
    ];

    expect(materialActualQtyForRequirement({ id: "req-b", item_id: "item-1" }, actuals)).toBe(20);
  });

  it("keeps item-id fallback when the item match is unambiguous", () => {
    const actuals = [{ item_id: "item-1", actual_qty: 7 }];

    expect(materialActualQtyForRequirement({ id: "req-a", item_id: "item-1" }, actuals)).toBe(7);
  });

  it("does not guess from item id when several actuals share the item", () => {
    const actuals = [
      { item_id: "item-1", actual_qty: 5 },
      { item_id: "item-1", actual_qty: 20 },
    ];

    expect(materialActualQtyForRequirement({ id: "req-b", item_id: "item-1" }, actuals)).toBeNull();
  });

  it("uses the legacy scalar fallback for old single-material events", () => {
    expect(materialActualQtyForRequirement({ id: "req-a", item_id: "item-1" }, null, 12)).toBe(12);
  });

  it("does not fall back by item id when authoritative requirement ids exist", () => {
    const actuals = [{ requirement_id: "stale-req", item_id: "item-1", actual_qty: 7 }];

    expect(materialActualQtyForRequirement({ id: "req-a", item_id: "item-1" }, actuals, 12)).toBeNull();
  });

  it("treats blank actual strings as missing", () => {
    const actuals = [{ item_id: "item-1", actual_qty: "" }];

    expect(materialActualQtyForRequirement({ id: "req-a", item_id: "item-1" }, actuals)).toBeNull();
  });
});
