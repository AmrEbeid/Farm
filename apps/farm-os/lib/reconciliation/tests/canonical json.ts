import { describe, expect, it } from "vitest";
import { canonicalStringify } from "../canonical json.mts";

describe("canonicalStringify", () => {
  it("sorts object keys regardless of insertion order", () => {
    const a = canonicalStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalStringify({ a: 2, c: { y: 2, z: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it("sorts keys inside array elements", () => {
    const out = canonicalStringify([{ b: 1, a: 2 }]);
    expect(out).toBe('[\n  {\n    "a": 2,\n    "b": 1\n  }\n]\n');
  });

  it("ends with exactly one trailing newline", () => {
    const out = canonicalStringify({ a: 1 });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("preserves array element order", () => {
    const out = canonicalStringify({ list: [3, 1, 2] });
    expect(out).toContain("[\n    3,\n    1,\n    2\n  ]");
  });
});
