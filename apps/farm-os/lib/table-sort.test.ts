import { describe, expect, it } from "vitest";
import { sortRows, type TableSortState } from "./table-sort";

const rows = [
  { id: "a", name: "الحصوة 10", qty: 10, note: null },
  { id: "b", name: "الحصوة 2", qty: 2, note: "ب" },
  { id: "c", name: "آبار", qty: 2, note: "أ" },
  { id: "d", name: "", qty: undefined, note: "" },
];

const columns = [
  { id: "name" },
  { id: "qty", numeric: true },
  { id: "note" },
];

describe("sortRows", () => {
  it("sorts Arabic text with numeric-aware collation", () => {
    const sorted = sortRows(rows, columns, { columnId: "name", direction: "asc" });
    expect(sorted.map((row) => row.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("sorts numeric columns numerically, not lexically", () => {
    const sorted = sortRows(rows, columns, { columnId: "qty", direction: "desc" });
    expect(sorted.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps empty values last in ascending sort", () => {
    const sorted = sortRows(rows, columns, { columnId: "note", direction: "asc" });
    expect(sorted.map((row) => row.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("is stable for tied values", () => {
    const sorted = sortRows(rows, columns, { columnId: "qty", direction: "asc" });
    expect(sorted.map((row) => row.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("returns the original row order for an unknown column", () => {
    const sort: TableSortState = { columnId: "missing", direction: "asc" };
    expect(sortRows(rows, columns, sort)).toBe(rows);
  });
});
