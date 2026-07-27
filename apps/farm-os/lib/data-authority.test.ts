import { describe, expect, it } from "vitest";
import { failClosedAuthority, isAuthoritative } from "./data-authority";

describe("data authority", () => {
  it("allows numerical claims only for verified data", () => {
    expect(isAuthoritative("verified")).toBe(true);
    expect(isAuthoritative("partial")).toBe(false);
    expect(isAuthoritative("unverified")).toBe(false);
    expect(isAuthoritative("blocked")).toBe(false);
    expect(isAuthoritative(undefined)).toBe(false);
  });

  it("treats a missing row as unverified", () => {
    expect(failClosedAuthority("budgets")).toEqual({
      domain: "budgets",
      status: "unverified",
      sourceLabel: null,
      recordCount: null,
      notes: null,
    });
  });
});
