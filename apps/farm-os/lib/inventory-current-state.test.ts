import { describe, expect, it } from "vitest";
import { currentInventoryState } from "./inventory-current-state";

describe("currentInventoryState", () => {
  it("keeps a missing bin unknown instead of inventing zero stock", () => {
    expect(currentInventoryState([], 5, null)).toEqual({ available: null, threshold: 5, status: "unknown" });
  });

  it("sums every location before applying the static reorder threshold", () => {
    expect(currentInventoryState([{ on_hand: 3, reserved: 1 }, { on_hand: 8, reserved: 2 }], 10, null))
      .toEqual({ available: 8, threshold: 10, status: "reorder" });
  });

  it("keeps known zero stock distinct even without a threshold", () => {
    expect(currentInventoryState([{ on_hand: 0, reserved: 0 }], null, null))
      .toEqual({ available: 0, threshold: 0, status: "above" });
  });
});
