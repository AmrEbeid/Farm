import { describe, expect, it } from "vitest";
import { parseExecuteInput } from "./execute-input";

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
