import { describe, it, expect } from "vitest";
import { filterRows, type FilterableRow } from "./filter";

const rows: FilterableRow[] = [
  { id: "1", name: "سماد بوتاسيوم", category: "أسمدة", qty: 600 },
  { id: "2", name: "سماد نيتروجين", category: "أسمدة", qty: 12 },
  { id: "3", name: "مبيد حشري", category: "مبيدات", qty: 5 },
];

describe("filterRows", () => {
  it("returns all rows for an empty or whitespace query", () => {
    expect(filterRows(rows, ["name"], "")).toHaveLength(3);
    expect(filterRows(rows, ["name"], "   ")).toHaveLength(3);
  });

  it("matches an Arabic substring within the named columns", () => {
    const r = filterRows(rows, ["name", "category"], "بوتاسيوم");
    expect(r.map((x) => x.id)).toEqual(["1"]);
  });

  it("matches across multiple columns (category)", () => {
    const r = filterRows(rows, ["name", "category"], "أسمدة");
    expect(r.map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("only searches the columns it is given (qty excluded)", () => {
    // "12" is the qty of row 2 but qty is not a searched column → no match.
    expect(filterRows(rows, ["name", "category"], "12")).toHaveLength(0);
    // include qty → it matches via the stringified number.
    expect(filterRows(rows, ["name", "qty"], "12").map((x) => x.id)).toEqual(["2"]);
  });

  it("is case-insensitive for Latin text", () => {
    const latin: FilterableRow[] = [{ id: "a", code: "PR-001" }];
    expect(filterRows(latin, ["code"], "pr-001")).toHaveLength(1);
  });

  it("ignores null/undefined cells without throwing", () => {
    const sparse: FilterableRow[] = [{ id: "x", name: null, category: undefined }];
    expect(filterRows(sparse, ["name", "category"], "foo")).toHaveLength(0);
  });
});
