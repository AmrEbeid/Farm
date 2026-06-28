import { describe, it, expect } from "vitest";
import {
  registerDescriptor,
  getDescriptor,
  listDescriptors,
  rpcsWithoutDescriptor,
} from "./registry";
import type { ImportDescriptor } from "./types";

const make = (key: string, rpc: string): ImportDescriptor => ({
  key,
  titleAr: key,
  rpc,
  role: "owner",
  columns: [],
  toRpcArgs: (r) => r,
});

describe("registry", () => {
  it("registers and retrieves a descriptor by key", () => {
    registerDescriptor(make("d1", "fn_one"));
    expect(getDescriptor("d1")?.rpc).toBe("fn_one");
    expect(listDescriptors().some((d) => d.key === "d1")).toBe(true);
  });

  it("rejects a duplicate key", () => {
    registerDescriptor(make("dup", "fn_x"));
    expect(() => registerDescriptor(make("dup", "fn_y"))).toThrow(/dup/);
  });

  it("rpcsWithoutDescriptor reports importable RPCs that have no descriptor", () => {
    const ds = [make("a", "fn_a"), make("b", "fn_b")];
    expect(rpcsWithoutDescriptor(["fn_a", "fn_b", "fn_c"], ds)).toEqual(["fn_c"]);
    expect(rpcsWithoutDescriptor(["fn_a", "fn_b"], ds)).toEqual([]);
  });
});
