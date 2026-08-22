import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prepareMarketingSource } from "./source-import";

describe("prepareMarketingSource", () => {
  it("rejects a source that does not carry the reviewed 25-area contract", () => {
    expect(() => prepareMarketingSource("<script>const FARM_FACTS={};</script>", "{}"))
      .toThrow("Missing required dataset declaration");
  });

  it("applies byte limits before parsing", () => {
    expect(() => prepareMarketingSource("x".repeat(2_000_001), "{}"))
      .toThrow("2 MB limit");
    expect(() => prepareMarketingSource("", "x".repeat(200_001)))
      .toThrow("200 KB limit");
  });
});
