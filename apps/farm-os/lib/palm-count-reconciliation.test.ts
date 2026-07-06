import { describe, expect, it } from "vitest";
import { buildPalmCountReconciliation } from "./palm-count-reconciliation";

describe("buildPalmCountReconciliation", () => {
  it("returns no mismatches when stored hawsha and line counts match live palms", () => {
    expect(
      buildPalmCountReconciliation({
        hawshat: [{ id: "h1", name: "حوش 1", palm_count_barhi: 2, palm_count_male: 1 }],
        lines: [{ id: "l1", line_no: 1, palm_count: 2 }, { id: "l2", line_no: 2, palm_count: 1 }],
        palms: [
          { id: "p1", hawsha_id: "h1", line_id: "l1" },
          { id: "p2", hawsha_id: "h1", line_id: "l1" },
          { id: "p3", hawsha_id: "h1", line_id: "l2" },
        ],
      }).mismatches,
    ).toEqual([]);
  });

  it("flags hawshat where stored barhi plus male differs from live palm assets", () => {
    const result = buildPalmCountReconciliation({
      hawshat: [{ id: "h1", name: "حوش 1", palm_count_barhi: 10, palm_count_male: 2 }],
      lines: [],
      palms: [
        { id: "p1", hawsha_id: "h1" },
        { id: "p2", hawsha_id: "h1" },
      ],
    });

    expect(result.hawshaMismatches).toEqual([
      {
        id: "h1",
        scope: "hawsha",
        label: "حوش 1",
        parentLabel: null,
        stored: 12,
        actual: 2,
        difference: -10,
        href: "/farm/hawsha/h1",
      },
    ]);
  });

  it("flags line counts independently from hawsha totals", () => {
    const result = buildPalmCountReconciliation({
      hawshat: [{ id: "h1", palm_count_barhi: 2, palm_count_male: 0 }],
      lines: [{ id: "l1", line_no: 7, palm_count: 1, hawshat: { name: "حوش 1" } }],
      palms: [
        { id: "p1", hawsha_id: "h1", line_id: "l1" },
        { id: "p2", hawsha_id: "h1", line_id: "l1" },
      ],
    });

    expect(result.hawshaMismatches).toEqual([]);
    expect(result.lineMismatches).toEqual([
      {
        id: "l1",
        scope: "line",
        label: "خط 7",
        parentLabel: "حوش 1",
        stored: 1,
        actual: 2,
        difference: 1,
        href: "/farm/line/l1",
      },
    ]);
  });

  it("surfaces lines with live palms but no stored count", () => {
    const result = buildPalmCountReconciliation({
      hawshat: [],
      lines: [{ id: "l1", line_code: "L-01", palm_count: null }],
      palms: [{ id: "p1", line_id: "l1" }],
    });

    expect(result.lineMismatches[0]).toMatchObject({
      label: "L-01",
      stored: null,
      actual: 1,
      difference: 1,
    });
  });

  it("does not flag null line counts when no live palms are attached", () => {
    expect(
      buildPalmCountReconciliation({
        hawshat: [],
        lines: [{ id: "l1", line_no: 1, palm_count: null }],
        palms: [],
      }).mismatches,
    ).toEqual([]);
  });

  it("counts unlined palms toward hawsha reconciliation without fabricating line mismatches", () => {
    const result = buildPalmCountReconciliation({
      hawshat: [{ id: "h1", palm_count_barhi: 1, palm_count_male: 0 }],
      lines: [{ id: "l1", line_no: 1, palm_count: 0 }],
      palms: [{ id: "p1", hawsha_id: "h1", line_id: null }],
    });

    expect(result.hawshaMismatches).toEqual([]);
    expect(result.lineMismatches).toEqual([]);
  });

  it("excludes removed, replaced, and archived palm rows from current-count reconciliation", () => {
    const result = buildPalmCountReconciliation({
      hawshat: [{ id: "h1", palm_count_barhi: 2, palm_count_male: 0 }],
      lines: [{ id: "l1", line_no: 1, palm_count: 2 }],
      palms: [
        { id: "p1", hawsha_id: "h1", line_id: "l1", status: "active", archived: false },
        { id: "p2", hawsha_id: "h1", line_id: "l1", status: "dead", archived: false },
        { id: "p3", hawsha_id: "h1", line_id: "l1", status: "removed", archived: false },
        { id: "p4", hawsha_id: "h1", line_id: "l1", status: "replaced", archived: false },
        { id: "p5", hawsha_id: "h1", line_id: "l1", status: "active", archived: true },
      ],
    });

    expect(result.mismatches).toEqual([]);
  });
});
