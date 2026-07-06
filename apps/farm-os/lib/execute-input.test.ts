import { describe, expect, it } from "vitest";
import { parseExecuteInput, parseMaterialActuals, parseLaborCount } from "./execute-input";

describe("parseLaborCount", () => {
  it("treats blank as 0 (labor is optional — SPEC-0030 A2)", () => {
    expect(parseLaborCount("")).toBe(0);
    expect(parseLaborCount("   ")).toBe(0);
  });
  it("parses a provided non-negative number, rejects invalid/negative", () => {
    expect(parseLaborCount("3")).toBe(3);
    expect(parseLaborCount("0")).toBe(0);
    expect(parseLaborCount("-1")).toBeNull();
    expect(parseLaborCount("x")).toBeNull();
  });
});

describe("parseExecuteInput", () => {
  it("still rejects a blank QUANTITY (it's meaningful for a material op)", () => {
    expect(parseExecuteInput("", "2")).toEqual({
      ok: false,
      error: "أدخل الكمية وعدد العمال قبل إنهاء العملية.",
      fieldErrors: { qty: "أدخل كمية صالحة." },
    });
  });

  it("coerces blank LABOR to 0 (labor is optional — SPEC-0030 A2)", () => {
    expect(parseExecuteInput("4", "   ")).toEqual({
      ok: true,
      value: { actualQty: 4, laborCount: 0 },
    });
  });

  it("with both blank, keys only the qty error (labor blank ⇒ 0, not an error)", () => {
    expect(parseExecuteInput("", "")).toMatchObject({
      ok: false,
      fieldErrors: { qty: "أدخل كمية صالحة." },
    });
  });

  it("allows an explicit zero because zero-material or zero-labor operations can be intentional", () => {
    expect(parseExecuteInput("0", "0")).toEqual({
      ok: true,
      value: { actualQty: 0, laborCount: 0 },
    });
  });

  it("rejects invalid or negative numbers", () => {
    expect(parseExecuteInput("-1", "1")).toMatchObject({ ok: false });
    expect(parseExecuteInput("1", "x")).toMatchObject({ ok: false });
  });
});

describe("parseMaterialActuals", () => {
  it("parses one entry per material, preserving requirementId order", () => {
    expect(
      parseMaterialActuals(
        [
          { requirementId: "r1", itemId: "a", qty: "5" },
          { requirementId: "r2", itemId: "b", qty: "10" },
        ],
        "3",
      ),
    ).toEqual({
      ok: true,
      value: {
        materialActuals: [
          { requirementId: "r1", itemId: "a", actualQty: 5 },
          { requirementId: "r2", itemId: "b", actualQty: 10 },
        ],
        laborCount: 3,
      },
    });
  });

  it("keeps two rows for the SAME itemId distinct by requirementId (#520 H1)", () => {
    // Two plan_material_requirements rows can legitimately share an item_id (e.g. two applications
    // of the same fertilizer on different sub-dates) — requirementId, not itemId, must be what
    // distinguishes them all the way through to the RPC payload.
    expect(
      parseMaterialActuals(
        [
          { requirementId: "r1", itemId: "same-item", qty: "5" },
          { requirementId: "r2", itemId: "same-item", qty: "20" },
        ],
        "1",
      ),
    ).toEqual({
      ok: true,
      value: {
        materialActuals: [
          { requirementId: "r1", itemId: "same-item", actualQty: 5 },
          { requirementId: "r2", itemId: "same-item", actualQty: 20 },
        ],
        laborCount: 1,
      },
    });
  });

  it("allows an explicit zero on any material or on labor", () => {
    expect(parseMaterialActuals([{ requirementId: "r1", itemId: "a", qty: "0" }], "0")).toEqual({
      ok: true,
      value: { materialActuals: [{ requirementId: "r1", itemId: "a", actualQty: 0 }], laborCount: 0 },
    });
  });

  it("rejects a blank quantity on ANY material, not just the first", () => {
    expect(
      parseMaterialActuals(
        [
          { requirementId: "r1", itemId: "a", qty: "5" },
          { requirementId: "r2", itemId: "b", qty: "" },
        ],
        "2",
      ),
    ).toEqual({
      ok: false,
      error: "أدخل كمية صالحة لكل خامة وعدد العمال قبل إنهاء العملية.",
      fieldErrors: { r2: "أدخل كمية صالحة." },
    });
  });

  it("keys the field error to the offending requirementId and to labor (F7)", () => {
    // A bad material row AND an INVALID (non-blank) labor → the map carries both the requirementId key
    // and "labor", so the multi-material form marks exactly the wrong controls. (Blank labor is now valid
    // ⇒ 0, SPEC-0030 A2 — so an invalid value, not a blank one, is what still errors.)
    expect(
      parseMaterialActuals(
        [
          { requirementId: "r1", itemId: "a", qty: "5" },
          { requirementId: "r2", itemId: "b", qty: "-3" },
        ],
        "x",
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { r2: "أدخل كمية صالحة.", labor: "أدخل عدد عمال صالح." },
    });
  });

  it("rejects a negative quantity on any material or an invalid/negative labor", () => {
    expect(parseMaterialActuals([{ requirementId: "r1", itemId: "a", qty: "-1" }], "1")).toMatchObject({
      ok: false,
    });
    expect(parseMaterialActuals([{ requirementId: "r1", itemId: "a", qty: "1" }], "-2")).toMatchObject({
      ok: false,
    });
  });

  it("coerces blank labor to 0 on a valid multi-material op (A2)", () => {
    expect(parseMaterialActuals([{ requirementId: "r1", itemId: "a", qty: "5" }], "")).toEqual({
      ok: true,
      value: { materialActuals: [{ requirementId: "r1", itemId: "a", actualQty: 5 }], laborCount: 0 },
    });
  });
});
