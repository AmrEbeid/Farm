import { describe, it, expect } from "vitest";
import { planCommit } from "./commit-plan";
import { setSourceRow, type ImportDescriptor } from "./types";

const base: ImportDescriptor = {
  key: "s",
  titleAr: "عينة",
  rpc: "fn_save",
  role: "owner",
  columns: [],
  toRpcArgs: (r) => ({ p_name: r.name }),
};

describe("planCommit", () => {
  it("maps each row to an RPC call via toRpcArgs, in order", () => {
    const plan = planCommit(base, [{ name: "أحمد" }, { name: "سعد" }]);
    expect(plan.calls).toEqual([
      { rpc: "fn_save", args: { p_name: "أحمد" }, sourceRow: 1 },
      { rpc: "fn_save", args: { p_name: "سعد" }, sourceRow: 2 },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("splits calls into chunks of the given size", () => {
    const rows = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const plan = planCommit(base, rows, { chunkSize: 2 });
    expect(plan.chunks.map((c) => c.length)).toEqual([2, 1]);
  });

  it("drops duplicate rows when a dedupeKey is set, recording them as skipped", () => {
    const d: ImportDescriptor = { ...base, dedupeKey: ["name"] };
    const plan = planCommit(d, [{ name: "أحمد" }, { name: "أحمد" }, { name: "سعد" }]);
    expect(plan.calls.map((c) => c.args.p_name)).toEqual(["أحمد", "سعد"]);
    expect(plan.skipped).toEqual([{ row: 2, reason: "صف مكرر" }]);
  });

  it("keeps original spreadsheet row numbers after validation filters rows", () => {
    const plan = planCommit(base, [setSourceRow({ name: "أحمد" }, 1), setSourceRow({ name: "سعد" }, 3)]);
    expect(plan.calls.map((c) => c.sourceRow)).toEqual([1, 3]);
  });

  it("keeps all rows when no dedupeKey is set", () => {
    const plan = planCommit(base, [{ name: "أحمد" }, { name: "أحمد" }]);
    expect(plan.calls).toHaveLength(2);
    expect(plan.skipped).toEqual([]);
  });

  it("passes the matched existing id into toRpcArgs as the second argument (update, not insert)", () => {
    const spy: ImportDescriptor = { ...base, toRpcArgs: (r, matchedId) => ({ p_name: r.name, p_id: matchedId ?? null }) };
    const plan = planCommit(spy, [setSourceRow({ name: "أحمد" }, 1)], { matchedIds: new Map([[1, "existing-id"]]) });
    expect(plan.calls[0].args).toEqual({ p_name: "أحمد", p_id: "existing-id" });
  });
});
