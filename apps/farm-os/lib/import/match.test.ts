import { describe, it, expect } from "vitest";
import { matchKeyOf, seenKeysOf, computeMatchPlan, type ExistingRow } from "./match";
import { setSourceRow, type ImportDescriptor } from "./types";

const d: ImportDescriptor = {
  key: "hawshat",
  titleAr: "أحواش",
  rpc: "fn_save_hawsha",
  role: "structure.write",
  columns: [],
  matchKey: ["code"],
  toRpcArgs: (r) => r,
};

describe("matchKeyOf", () => {
  it("joins matchKey column values", () => {
    expect(matchKeyOf(d, { code: "H-01" })).toBe("H-01");
  });

  it("normalizes Arabic-Indic digits so a row typed in Arabic digits still matches", () => {
    const numeric: ImportDescriptor = { ...d, matchKey: ["lineNo"] };
    expect(matchKeyOf(numeric, { lineNo: "٥" })).toBe(matchKeyOf(numeric, { lineNo: "5" }));
  });

  it("joins composite keys with a separator that can't collide across fields", () => {
    const composite: ImportDescriptor = { ...d, matchKey: ["hawshaId", "lineNo"] };
    expect(matchKeyOf(composite, { hawshaId: "H-01", lineNo: "12" })).not.toBe(
      matchKeyOf(composite, { hawshaId: "H", lineNo: "0112" }),
    );
  });
});

describe("seenKeysOf", () => {
  it("computes the seen set from RAW rows, even ones that will fail validation", () => {
    const rawRows = [{ code: "H-01", name: "" }, { code: "H-02", name: "ok" }];
    expect(seenKeysOf(d, rawRows)).toEqual(new Set(["H-01", "H-02"]));
  });
});

describe("computeMatchPlan", () => {
  const existing: ExistingRow[] = [
    { id: "id-1", key: "H-01", label: "H-01" },
    { id: "id-2", key: "H-02", label: "H-02" },
  ];

  it("matches a valid row to its existing id by matchKey", () => {
    const validRows = [setSourceRow({ code: "H-01" }, 1)];
    const plan = computeMatchPlan(d, new Set(["H-01"]), validRows, existing);
    expect(plan.matchedIds.get(1)).toBe("id-1");
  });

  it("leaves an unmatched valid row absent from matchedIds (it's an insert)", () => {
    const validRows = [setSourceRow({ code: "H-03" }, 1)];
    const plan = computeMatchPlan(d, new Set(["H-03"]), validRows, existing);
    expect(plan.matchedIds.has(1)).toBe(false);
  });

  it("reports an existing row missing from the seen set as toArchive", () => {
    const plan = computeMatchPlan(d, new Set(["H-01"]), [setSourceRow({ code: "H-01" }, 1)], existing);
    expect(plan.toArchive).toEqual([{ id: "id-2", label: "H-02" }]);
  });

  it("does NOT archive a row that is present but currently invalid (protects on presence, not validity)", () => {
    const plan = computeMatchPlan(d, new Set(["H-01", "H-02"]), [setSourceRow({ code: "H-01" }, 1)], existing);
    expect(plan.toArchive).toEqual([]);
  });
});
