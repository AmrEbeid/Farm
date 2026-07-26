import { describe, expect, it } from "vitest";
import { stableUuid } from "../stable id.mts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("stableUuid", () => {
  it("is deterministic for the same parts", () => {
    expect(stableUuid("a", "b", "c")).toBe(stableUuid("a", "b", "c"));
  });

  it("looks like a valid UUID", () => {
    expect(stableUuid("x")).toMatch(UUID_RE);
  });

  it("differs for different parts", () => {
    expect(stableUuid("a", "b")).not.toBe(stableUuid("a", "c"));
  });

  it("does not collide across a naive join boundary", () => {
    expect(stableUuid("ab", "c")).not.toBe(stableUuid("a", "bc"));
  });

  it("differs by part order", () => {
    expect(stableUuid("a", "b")).not.toBe(stableUuid("b", "a"));
  });
});
