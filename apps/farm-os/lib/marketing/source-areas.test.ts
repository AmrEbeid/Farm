import { describe, expect, it } from "vitest";
import { MARKETING_SOURCE_AREAS, marketingSourceAreaHref } from "./source-areas";

describe("Marketing source-area registry", () => {
  it("maps each source area exactly once to one of the five Marketing routes", () => {
    expect(MARKETING_SOURCE_AREAS).toHaveLength(25);
    expect(new Set(MARKETING_SOURCE_AREAS.map((area) => area.sourceId)).size).toBe(25);
    expect(MARKETING_SOURCE_AREAS.every((area) => marketingSourceAreaHref(area).startsWith(area.route))).toBe(true);
    expect(new Set(MARKETING_SOURCE_AREAS.map((area) => area.route))).toEqual(new Set([
      "/marketing",
      "/marketing/product",
      "/marketing/markets",
      "/marketing/pipeline",
      "/marketing/campaigns",
    ]));
  });
});
