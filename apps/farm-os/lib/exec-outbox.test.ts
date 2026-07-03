import { describe, expect, it } from "vitest";
import { upsertEntry, removeEntry, parseOutbox, type OutboxEntry } from "./exec-outbox";

const entry = (opId: string, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: opId,
  opId,
  opLabel: "تلقيح",
  payload: { actualQty: 5, laborCount: 2, note: "" },
  queuedAt: "2026-07-03T00:00:00.000Z",
  ...extra,
});

describe("upsertEntry", () => {
  it("appends a new op", () => {
    expect(upsertEntry([], entry("a")).map((e) => e.opId)).toEqual(["a"]);
    expect(upsertEntry([entry("a")], entry("b")).map((e) => e.opId)).toEqual(["a", "b"]);
  });

  it("REPLACES an existing op (a fresh submit supersedes the queued payload, no duplicate)", () => {
    const first = entry("a", { payload: { actualQty: 5, laborCount: 2, note: "" } });
    const second = entry("a", { payload: { actualQty: 9, laborCount: 3, note: "" } });
    const out = upsertEntry([first, entry("b")], second);
    expect(out.map((e) => e.opId)).toEqual(["b", "a"]); // 'a' de-duped, moved to newest
    expect(out.find((e) => e.opId === "a")?.payload.actualQty).toBe(9);
  });
});

describe("removeEntry", () => {
  it("removes by id and leaves the rest", () => {
    expect(removeEntry([entry("a"), entry("b")], "a").map((e) => e.opId)).toEqual(["b"]);
  });
  it("is a no-op for an unknown id", () => {
    expect(removeEntry([entry("a")], "zzz").map((e) => e.opId)).toEqual(["a"]);
  });
});

describe("parseOutbox (tolerant — a broken outbox must degrade to empty, never throw)", () => {
  it("returns [] for null / empty", () => {
    expect(parseOutbox(null)).toEqual([]);
    expect(parseOutbox("")).toEqual([]);
  });
  it("returns [] for corrupt JSON", () => {
    expect(parseOutbox("{not json")).toEqual([]);
  });
  it("returns [] when the payload is not an array", () => {
    expect(parseOutbox(JSON.stringify({ opId: "a" }))).toEqual([]);
  });
  it("drops malformed entries but keeps valid ones", () => {
    const raw = JSON.stringify([
      entry("good"),
      { opId: "missing-fields" },
      { id: "x", opId: "y", opLabel: "z", queuedAt: "t", payload: null },
      42,
    ]);
    const out = parseOutbox(raw);
    expect(out.map((e) => e.opId)).toEqual(["good"]);
  });
  it("round-trips a valid entry", () => {
    const e = entry("a", { payload: { actualQty: 0, materialActuals: [{ requirementId: "r1", itemId: "i1", actualQty: 3 }], laborCount: 1, note: "" } });
    expect(parseOutbox(JSON.stringify([e]))).toEqual([e]);
  });
});
