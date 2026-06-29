import { describe, it, expect } from "vitest";
import { validateRows } from "./validate";
import type { ImportDescriptor } from "./types";

const descriptor: ImportDescriptor = {
  key: "sample",
  titleAr: "عينة",
  rpc: "fn_noop",
  role: "owner",
  columns: [
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "أحمد" },
    { key: "qty", labelAr: "الكمية", type: "int", required: true, example: "5" },
    { key: "price", labelAr: "السعر", type: "decimal", required: true, example: "9.5" },
    { key: "on", labelAr: "التاريخ", type: "date", required: true, format: "YYYY-MM-DD", example: "2026-01-31" },
    { key: "kind", labelAr: "النوع", type: "enum", required: true, enumValues: ["a", "b"], example: "a" },
  ],
  toRpcArgs: (r) => r,
};

describe("validateRows", () => {
  it("accepts a fully valid row and coerces numeric types", () => {
    const r = validateRows(descriptor, [
      { name: "أحمد", qty: "5", price: "9.5", on: "2026-01-31", kind: "a" },
    ]);
    expect(r.errorCount).toBe(0);
    expect(r.okCount).toBe(1);
    expect(r.okRows[0]).toEqual({ name: "أحمد", qty: 5, price: 9.5, on: "2026-01-31", kind: "a" });
  });

  it("flags a missing required field", () => {
    const r = validateRows(descriptor, [{ name: "", qty: "5", price: "9.5", on: "2026-01-31", kind: "a" }]);
    expect(r.errorCount).toBe(1);
    expect(r.errors).toContainEqual({ row: 1, column: "name", reason: "حقل مطلوب" });
    expect(r.okRows).toHaveLength(0);
  });

  it("rejects a non-integer qty and a non-ISO date", () => {
    const r = validateRows(descriptor, [{ name: "أحمد", qty: "5.5", price: "x", on: "31/01/2026", kind: "a" }]);
    const cols = r.errors.map((e) => e.column).sort();
    expect(cols).toEqual(["on", "price", "qty"]);
    expect(r.errors.find((e) => e.column === "on")?.reason).toBe("يجب أن يكون التاريخ بصيغة YYYY-MM-DD");
  });

  it("rejects impossible calendar dates", () => {
    const r = validateRows(descriptor, [{ name: "أحمد", qty: "5", price: "9.5", on: "2026-02-31", kind: "a" }]);
    expect(r.errorCount).toBe(1);
    expect(r.errors).toContainEqual({ row: 1, column: "on", reason: "يجب أن يكون التاريخ بصيغة YYYY-MM-DD" });
    expect(r.okRows).toHaveLength(0);
  });

  it("rejects an enum value outside the allowed set", () => {
    const r = validateRows(descriptor, [{ name: "أحمد", qty: "5", price: "9.5", on: "2026-01-31", kind: "z" }]);
    expect(r.errors).toContainEqual({ row: 1, column: "kind", reason: "قيمة غير مسموح بها" });
  });

  it("keeps good rows when other rows are bad (partial success)", () => {
    const r = validateRows(descriptor, [
      { name: "أحمد", qty: "5", price: "9.5", on: "2026-01-31", kind: "a" },
      { name: "", qty: "bad", price: "9.5", on: "2026-01-31", kind: "a" },
    ]);
    expect(r.okCount).toBe(1);
    expect(r.errorCount).toBe(1);
  });
});
