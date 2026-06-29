import { describe, it, expect, vi } from "vitest";
import { resolveRefs, type RefLookup } from "./resolve";
import type { ImportDescriptor } from "./types";

const withRef: ImportDescriptor = {
  key: "hawshat",
  titleAr: "أحواش",
  rpc: "fn_save_hawsha",
  role: "structure.write",
  columns: [
    { key: "sectorId", labelAr: "كود القطاع", type: "string", required: true, example: "S-01", ref: { table: "sectors", codeColumn: "code" } },
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "حوش 1" },
  ],
  toRpcArgs: (r) => r,
};

const noRef: ImportDescriptor = {
  key: "x",
  titleAr: "x",
  rpc: "fn_x",
  role: "owner",
  columns: [{ key: "name", labelAr: "الاسم", type: "string", required: true, example: "a" }],
  toRpcArgs: (r) => r,
};

// fake lookup: every code resolves to "<table>:<code>" except "MISSING"
const fakeLookup: RefLookup = async (spec, codes) =>
  new Map(codes.filter((c) => c !== "MISSING").map((c) => [c, `${spec.table}:${c}`]));

describe("resolveRefs", () => {
  it("passes rows through unchanged when the descriptor has no ref columns", async () => {
    const r = await resolveRefs(noRef, [{ name: "a" }], fakeLookup);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ name: "a" }]);
  });

  it("replaces a code with its resolved id", async () => {
    const r = await resolveRefs(withRef, [{ sectorId: "S-01", name: "حوش 1" }], fakeLookup);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ sectorId: "sectors:S-01", name: "حوش 1" }]);
  });

  it("flags an unresolved code and drops the row", async () => {
    const r = await resolveRefs(
      withRef,
      [{ sectorId: "S-01", name: "ok" }, { sectorId: "MISSING", name: "bad" }],
      fakeLookup,
    );
    expect(r.rows).toEqual([{ sectorId: "sectors:S-01", name: "ok" }]);
    expect(r.errors).toEqual([{ row: 2, column: "sectorId", reason: "لم يتم العثور على هذا الكود" }]);
  });

  it("looks up each ref column once over the distinct codes", async () => {
    const spy = vi.fn(fakeLookup);
    await resolveRefs(
      withRef,
      [{ sectorId: "S-01", name: "a" }, { sectorId: "S-01", name: "b" }],
      spy,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual(["S-01"]); // deduped
  });
});
