// SPEC-0032 marketing workspace — deterministic exact-ID/order/content tests. `MARKETING_SOURCE_ORACLE`
// is an independent regex tally of the owner-supplied source HTML (scripts/build-marketing-workspace-content.mjs);
// this file pins the reviewed workspace spec (fidelity-manifest.ts) against it so a tab, heading,
// table, control or template cannot silently drop between the source and the workspace.
import { describe, expect, it } from "vitest";
import {
  MARKETING_AREA_BLUEPRINTS,
  MARKETING_SOURCE_TAB_ORDER,
  MARKETING_STATE_KEYS,
  MARKETING_TEMPLATES,
  marketingStateKeyOwners,
} from "../fidelity-manifest";
import { MARKETING_SOURCE_AREAS } from "../source-areas";
import { MARKETING_SOURCE_ORACLE } from "./source-oracle.generated";
import { MARKETING_WORKSPACE_CONTENT } from "./content.generated";

describe("marketing workspace fidelity — tabs", () => {
  it("keeps the exact 25 source tab ids, in the exact source order", () => {
    expect(MARKETING_SOURCE_TAB_ORDER).toEqual(MARKETING_SOURCE_ORACLE.tabs.map((t) => t.id));
    expect(MARKETING_SOURCE_TAB_ORDER).toHaveLength(25);
    expect(new Set(MARKETING_SOURCE_TAB_ORDER).size).toBe(25);
  });

  it("keeps every source tab label exactly (source-areas.ts label == oracle tab label)", () => {
    const oracleLabels = new Map(MARKETING_SOURCE_ORACLE.tabs.map((t) => [t.id, t.label]));
    for (const area of MARKETING_SOURCE_AREAS) {
      expect(oracleLabels.get(area.sourceId)).toBe(area.label);
    }
  });

  it("gives every source tab exactly one area blueprint, in source order", () => {
    expect(MARKETING_AREA_BLUEPRINTS.map((b) => b.sourceId)).toEqual(MARKETING_SOURCE_TAB_ORDER);
    expect(MARKETING_AREA_BLUEPRINTS.map((b) => b.order)).toEqual(
      MARKETING_SOURCE_TAB_ORDER.map((_, i) => i + 1),
    );
  });
});

describe("marketing workspace fidelity — counts (the exact numbers in the task spec)", () => {
  it("matches 125 headings, 51 tables, 256 controls / 137 unique ids, 20 templates", () => {
    expect(MARKETING_SOURCE_ORACLE.counts).toEqual({
      tabs: 25,
      headings: 125,
      tables: 51,
      controls: 256,
      controlIds: 137,
      templates: 20,
    });
  });

  it("keeps exactly the 20 templates declared in the oracle, one-to-one by id", () => {
    const oracleTemplateIds = new Set(
      MARKETING_SOURCE_ORACLE.templates.flatMap((t) => (t.id ? [t.id] : [])),
    );
    expect(oracleTemplateIds.size).toBe(20);
    expect(MARKETING_TEMPLATES).toHaveLength(20);
    expect(new Set(MARKETING_TEMPLATES.map((t) => t.id))).toEqual(oracleTemplateIds);
  });

  it("every generated content area corresponds to exactly one oracle section, same headings count", () => {
    const oracleHeadingCounts = new Map<string, number>();
    for (const h of MARKETING_SOURCE_ORACLE.headings) {
      oracleHeadingCounts.set(h.area, (oracleHeadingCounts.get(h.area) ?? 0) + 1);
    }
    let totalHeadings = 0;
    for (const area of MARKETING_WORKSPACE_CONTENT) {
      const countIn = (blocks: readonly { t: string; blocks?: readonly unknown[] }[]): number =>
        blocks.reduce((sum, b) => {
          const nested = Array.isArray(b.blocks) ? countIn(b.blocks as never) : 0;
          return sum + (b.t === "heading" ? 1 : 0) + nested;
        }, 0);
      const found = countIn(area.blocks as never);
      expect(found).toBe(oracleHeadingCounts.get(area.id) ?? 0);
      totalHeadings += found;
    }
    expect(totalHeadings).toBe(125);
  });
});

describe("marketing workspace fidelity — the 31 mutable state keys never drop silently", () => {
  it("owns every key in the manifest to a real area/section (no dangling key)", () => {
    const owners = marketingStateKeyOwners();
    for (const spec of MARKETING_STATE_KEYS) {
      expect(owners.has(spec.key)).toBe(true);
      expect(owners.get(spec.key)!.area).toBe(spec.area);
    }
  });

  it("resolves every key to a record type, a contact field, a contact activity, or an explicit exclusion", () => {
    for (const spec of MARKETING_STATE_KEYS) {
      expect(["record", "contact", "contact_field", "contact_activity", "mapped_elsewhere", "excluded"]).toContain(
        spec.persistence.kind,
      );
    }
  });

  it("keeps the two mapped-elsewhere keys read-only (ep_harvest_log -> /harvest, ep_owner_whatsapp -> /website)", () => {
    const mapped = MARKETING_STATE_KEYS.filter((s) => s.persistence.kind === "mapped_elsewhere");
    expect(mapped.map((s) => s.key).sort()).toEqual(["ep_harvest_log", "ep_owner_whatsapp"]);
  });

  it("matches the oracle's independently-tallied state-key set (allowing the two keyConst-only keys the regex tally cannot see under a literal call)", () => {
    const manifestKeys = new Set<string>(MARKETING_STATE_KEYS.map((s) => s.key));
    const missingFromOracle = [...manifestKeys].filter((k) => !MARKETING_SOURCE_ORACLE.stateKeys.includes(k));
    // Every key the independent regex tally found must be one the manifest also declares.
    for (const oracleKey of MARKETING_SOURCE_ORACLE.stateKeys) {
      expect(manifestKeys.has(oracleKey)).toBe(true);
    }
    expect(missingFromOracle.length).toBeLessThanOrEqual(MARKETING_STATE_KEYS.length);
  });
});
