import { describe, expect, it } from "vitest";
import { parseExecuteInput, parseMaterialActuals } from "./execute-input";

describe("parseExecuteInput", () => {
  it("rejects blank quantity or labor instead of coercing them to zero", () => {
    expect(parseExecuteInput("", "2")).toEqual({
      ok: false,
      error: "أدخل الكمية وعدد العمال قبل إنهاء العملية.",
    });
    expect(parseExecuteInput("4", "   ")).toEqual({
      ok: false,
      error: "أدخل الكمية وعدد العمال قبل إنهاء العملية.",
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
  it("parses one entry per material, preserving itemId order", () => {
    expect(
      parseMaterialActuals(
        [
          { itemId: "a", qty: "5" },
          { itemId: "b", qty: "10" },
        ],
        "3",
      ),
    ).toEqual({
      ok: true,
      value: {
        materialActuals: [
          { itemId: "a", actualQty: 5 },
          { itemId: "b", actualQty: 10 },
        ],
        laborCount: 3,
      },
    });
  });

  it("allows an explicit zero on any material or on labor", () => {
    expect(parseMaterialActuals([{ itemId: "a", qty: "0" }], "0")).toEqual({
      ok: true,
      value: { materialActuals: [{ itemId: "a", actualQty: 0 }], laborCount: 0 },
    });
  });

  it("rejects a blank quantity on ANY material, not just the first", () => {
    expect(
      parseMaterialActuals(
        [
          { itemId: "a", qty: "5" },
          { itemId: "b", qty: "" },
        ],
        "2",
      ),
    ).toEqual({ ok: false, error: "أدخل كمية صالحة لكل خامة وعدد العمال قبل إنهاء العملية." });
  });

  it("rejects a negative quantity on any material or blank/negative labor", () => {
    expect(parseMaterialActuals([{ itemId: "a", qty: "-1" }], "1")).toMatchObject({ ok: false });
    expect(parseMaterialActuals([{ itemId: "a", qty: "1" }], "")).toMatchObject({ ok: false });
  });
});
