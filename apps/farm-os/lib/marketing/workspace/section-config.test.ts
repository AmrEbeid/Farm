import { describe, expect, it } from "vitest";
import { MARKETING_AREA_BLUEPRINTS, MARKETING_TEMPLATES } from "../fidelity-manifest";
import { MARKETING_CALCULATOR_IDS } from "./calculators";
import { WORKSPACE_RECORD_SECTIONS } from "./section-config";

const RECORD_BACKED_KINDS = new Set(["records", "reference"]);

describe("marketing workspace section-config — every renderable section has a real config", () => {
  const allSections = MARKETING_AREA_BLUEPRINTS.flatMap((area) => area.sections.map((section) => ({ area: area.sourceId, section })));

  it("every 'records'/'reference' blueprint section has a WORKSPACE_RECORD_SECTIONS entry", () => {
    for (const { area, section } of allSections) {
      if (!RECORD_BACKED_KINDS.has(section.kind)) continue;
      expect(WORKSPACE_RECORD_SECTIONS[section.id], `${area}/${section.id} needs a section-config entry`).toBeDefined();
      expect(WORKSPACE_RECORD_SECTIONS[section.id].recordType).toBe(section.recordType);
    }
  });

  it("has no stray WORKSPACE_RECORD_SECTIONS entry the blueprint no longer references", () => {
    const knownIds = new Set(allSections.filter((s) => RECORD_BACKED_KINDS.has(s.section.kind)).map((s) => s.section.id));
    for (const id of Object.keys(WORKSPACE_RECORD_SECTIONS)) {
      expect(knownIds.has(id)).toBe(true);
    }
  });

  it("every 'templates' blueprint section's templateIds resolve to real MARKETING_TEMPLATES entries", () => {
    const templateIds = new Set<string>(MARKETING_TEMPLATES.map((t) => t.id));
    for (const { section } of allSections) {
      if (section.kind !== "templates") continue;
      expect(section.templateIds && section.templateIds.length > 0).toBe(true);
      for (const id of section.templateIds ?? []) expect(templateIds.has(id)).toBe(true);
    }
    // every one of the 20 templates is claimed by exactly one templates section
    const claimed = allSections.filter((s) => s.section.kind === "templates").flatMap((s) => s.section.templateIds ?? []);
    expect([...claimed].sort()).toEqual([...templateIds].sort());
  });

  it("every 'calculator' blueprint section uses one of the 4 known calculator ids", () => {
    for (const { section } of allSections) {
      if (section.kind !== "calculator") continue;
      expect(section.calculatorId).toBeDefined();
      expect(MARKETING_CALCULATOR_IDS).toContain(section.calculatorId);
    }
    const used = new Set(allSections.filter((s) => s.section.kind === "calculator").map((s) => s.section.calculatorId));
    expect(used).toEqual(new Set(MARKETING_CALCULATOR_IDS));
  });

  it("every 'checklist' blueprint section carries a recordType + payloadKind to filter task rows by", () => {
    for (const { section } of allSections) {
      if (section.kind !== "checklist") continue;
      expect(section.recordType).toBe("task");
      expect(section.payloadKind).toBeTruthy();
    }
  });
});
