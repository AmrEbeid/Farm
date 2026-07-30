import { describe, expect, it } from "vitest";
import {
  buildPalmSourceReconciliation,
  EBEID_PALM_SOURCE_MANIFEST,
  type PalmSourceIssueCode,
} from "./palm-source-reconciliation";

function issueCodes(): PalmSourceIssueCode[] {
  return buildPalmSourceReconciliation().issues.map((issue) => issue.code);
}

describe("buildPalmSourceReconciliation", () => {
  it("derives the source arithmetic without treating a stated total as truth", () => {
    expect(buildPalmSourceReconciliation().derived).toEqual({
      barhiRowTotal2026: 4638,
      maleRowTotal2026: 370,
      barhiUnitColumns2026: 26,
      impliedUnitColumns2026: 28,
      headingTotal2021: 782,
      rangeTotal2021: 759,
      rangeSizes2021: [125, 143, 108, 132, 108, 143],
    });
  });

  it("reports the 2026 total, sector, shape, date, and unit-count contradictions", () => {
    expect(issueCodes()).toEqual(
      expect.arrayContaining([
        "BARHI_TOTAL_MISMATCH",
        "DUPLICATE_SECTOR_NUMBER",
        "UNIT_SHAPE_MISMATCH",
        "MALFORMED_PLANTING_DATE",
        "UNIT_COUNT_AMBIGUOUS",
      ]),
    );
    expect(
      buildPalmSourceReconciliation().issues.filter(
        (issue) => issue.code === "MALFORMED_PLANTING_DATE",
      ),
    ).toHaveLength(2);
  });

  it("reports both 2021 heading arithmetic and per-hawsha range conflicts", () => {
    expect(issueCodes()).toEqual(
      expect.arrayContaining(["NUMBERING_HEADING_TOTAL_MISMATCH", "NUMBERING_RANGE_MISMATCH"]),
    );
    expect(
      buildPalmSourceReconciliation().issues.find(
        (issue) => issue.code === "NUMBERING_RANGE_MISMATCH",
      )?.message,
    ).toContain("hawsha 3: heading 132, range 108");
  });

  it("keeps the old aggregate baseline explicitly disputed", () => {
    const issue = buildPalmSourceReconciliation().issues.find(
      (candidate) => candidate.code === "DISPUTED_BASELINE_CONFLICT",
    );

    expect(issue).toMatchObject({
      expected: "4380/299/28",
      actual: "4638/370/28",
    });
  });

  it("rejects normalized calendar overflows as malformed dates", () => {
    const manifest = structuredClone(EBEID_PALM_SOURCE_MANIFEST);
    manifest.source2026.blocks[0].plantingDateValues = ["2026-02-30"];

    expect(
      buildPalmSourceReconciliation(manifest).issues.some(
        (issue) => issue.code === "MALFORMED_PLANTING_DATE" && issue.actual === "2026-02-30",
      ),
    ).toBe(true);
  });

  it("fails closed and never emits an import payload", () => {
    const result = buildPalmSourceReconciliation();

    expect(result.authorityState).toBe("blocked");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.importPayload).toBeNull();
  });

  it("keeps evidence locators relative and pins every source by SHA-256", () => {
    const sources = [
      EBEID_PALM_SOURCE_MANIFEST.source2026,
      EBEID_PALM_SOURCE_MANIFEST.numbering2021,
      EBEID_PALM_SOURCE_MANIFEST.inspection2021,
    ];

    for (const source of sources) {
      expect(source.locator).not.toMatch(/^[/~]/);
      expect(source.locator).not.toContain("/Users/");
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
