import { describe, it, expect } from "vitest";
import { filterRows, normalizeArabic, type FilterableRow } from "./filter";

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

  it("folds ta-marbuta so نخله matches نخلة (and vice-versa)", () => {
    const palms: FilterableRow[] = [{ id: "p", name: "نخلة" }];
    expect(filterRows(palms, ["name"], "نخله").map((x) => x.id)).toEqual(["p"]);
    const palms2: FilterableRow[] = [{ id: "q", name: "نخله" }];
    expect(filterRows(palms2, ["name"], "نخلة").map((x) => x.id)).toEqual(["q"]);
  });

  it("folds alef forms so bare-alef ابراهيم matches hamza-alef إبراهيم", () => {
    const people: FilterableRow[] = [{ id: "n", name: "إبراهيم" }];
    expect(filterRows(people, ["name"], "ابراهيم").map((x) => x.id)).toEqual(["n"]);
  });

  it("strips tashkeel so مُحَمَّد matches محمد", () => {
    const people: FilterableRow[] = [{ id: "m", name: "مُحَمَّد" }];
    expect(filterRows(people, ["name"], "محمد").map((x) => x.id)).toEqual(["m"]);
  });

  it("removes tatweel so محـمد matches محمد", () => {
    const data: FilterableRow[] = [{ id: "t", name: "محـمد" }];
    expect(filterRows(data, ["name"], "محمد").map((x) => x.id)).toEqual(["t"]);
  });
});

describe("normalizeArabic", () => {
  it("is a no-op for Latin/ASCII text", () => {
    expect(normalizeArabic("PR-001 Widget_42")).toBe("PR-001 Widget_42");
  });

  it("strips tashkeel, tatweel and folds alef/maksura/ta-marbuta", () => {
    expect(normalizeArabic("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabic("محـمد")).toBe("محمد");
    expect(normalizeArabic("إبراهيم")).toBe("ابراهيم");
    expect(normalizeArabic("نخلة")).toBe("نخله");
    expect(normalizeArabic("مصطفى")).toBe("مصطفي");
  });
});
