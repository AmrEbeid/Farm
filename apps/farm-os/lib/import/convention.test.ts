import { describe, it, expect } from "vitest";
import { listDescriptors, rpcsWithoutDescriptor } from "./registry";
import { IMPORTABLE_RPCS } from "./importable-rpcs";
import "./descriptors"; // side-effect: registers all descriptors

describe("import convention (IMP-9)", () => {
  it("every importable RPC has a registered descriptor", () => {
    const missing = rpcsWithoutDescriptor([...IMPORTABLE_RPCS], listDescriptors());
    expect(missing).toEqual([]);
  });
});
