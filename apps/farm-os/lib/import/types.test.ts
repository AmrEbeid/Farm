import { describe, expect, it } from "vitest";
import { setSourceRow, getSourceRow } from "./types";

describe("import source-row tracking (setSourceRow / getSourceRow)", () => {
  it("round-trips the source row", () => {
    const row = setSourceRow({ code: "A1" }, 7);
    expect(getSourceRow(row, -1)).toBe(7);
  });

  it("returns the fallback when no source row was set", () => {
    expect(getSourceRow({ code: "A1" }, 99)).toBe(99);
  });

  it("stores the marker as a NON-ENUMERABLE property — it must never leak into the import payload", () => {
    // This is the invariant that matters: the RPC receives the row's data, and the source-row marker
    // must not appear in Object.keys / spreads / JSON, or it would corrupt what gets imported.
    const row = setSourceRow({ code: "A1", qty: 5 }, 3);
    expect(Object.keys(row)).toEqual(["code", "qty"]);
    expect(JSON.stringify(row)).toBe(JSON.stringify({ code: "A1", qty: 5 }));
    expect({ ...row }).toEqual({ code: "A1", qty: 5 });
  });

  it("returns the same row reference (mutates in place) so callers can chain", () => {
    const row = { code: "A1" };
    expect(setSourceRow(row, 1)).toBe(row);
  });

  it("is re-settable (configurable) — a later setSourceRow overwrites the earlier value", () => {
    const row = setSourceRow({ code: "A1" }, 1);
    setSourceRow(row, 2);
    expect(getSourceRow(row, -1)).toBe(2);
  });

  it("preserves the marker across a distinct read path (Symbol.for global registry)", () => {
    // getSourceRow resolves the marker via Symbol.for, so a row marked by one module is readable by
    // another that never shared the Symbol reference directly.
    const row = setSourceRow({ code: "A1" }, 42);
    const roundTrippedKey = Symbol.for("farm.import.sourceRow");
    expect((row as Record<symbol, unknown>)[roundTrippedKey]).toBe(42);
  });
});
