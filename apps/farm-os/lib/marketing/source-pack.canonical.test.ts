import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractMarketingSource } from "./source-extractor";
import { buildMarketingSourcePack } from "./source-pack";
import { MARKETING_SOURCE_AREAS } from "./source-areas";

const enabled = process.env.RUN_MARKETING_SOURCE_CANONICAL === "1";
const canonical = enabled ? describe : describe.skip;

canonical("canonical Marketing source pack", () => {
  it("maps all 25 source areas and preserves every static row through import rows or coverage", () => {
    const htmlPath = process.env.MARKETING_SOURCE_HTML;
    const statePath = process.env.MARKETING_SOURCE_STATE;
    if (!htmlPath || !statePath) throw new Error("Canonical Marketing source paths are required");
    const manifest = extractMarketingSource(readFileSync(htmlPath, "utf8"), readFileSync(statePath, "utf8"));
    const pack = buildMarketingSourcePack(manifest);
    expect(pack.coverage.tabs).toHaveLength(25);
    expect(pack.coverage.tabs).toEqual(MARKETING_SOURCE_AREAS.map((area) => area.sourceId));
    expect(pack.coverage.templates).toBe(20);
    expect(pack.coverage.sourceRows).toEqual(manifest.coverage.datasets);
    expect(pack.contacts).toHaveLength(1_571);
    expect(pack.contacts.filter((contact) => contact.selected)).toHaveLength(2);
    expect(pack.records).toHaveLength(101);
    expect(pack.records.filter((record) => record.recordType === "message_template")).toHaveLength(20);
    expect(pack.records.filter((record) => record.recordType === "platform_state")).toHaveLength(29);
    expect(pack.records.filter((record) => record.recordType === "certificate")).toHaveLength(4);
    expect(pack.records.filter((record) => record.recordType === "freight_reference")).toHaveLength(12);
    expect(pack.records.filter((record) => record.recordType === "market_reference")).toHaveLength(8);
    expect(pack.records.filter((record) => record.recordType === "channel_target")).toHaveLength(6);
    expect(pack.records.filter((record) => record.recordType === "price_observation")).toHaveLength(8);
    expect(pack.records.filter((record) => record.recordType === "lead_offshoot")).toHaveLength(2);
    expect(pack.records.filter((record) => record.recordType === "task")).toHaveLength(12);
    expect(pack.coverage.mutableStateKeys).toHaveLength(31);
    expect(pack.coverage.mutableStateKeys).toContain("ep_kuwait_dist_notes");
    expect(new Set(pack.contacts.map((contact) => contact.sourceKey)).size).toBe(pack.contacts.length);
    expect(new Set(pack.records.map((record) => record.sourceKey)).size).toBe(pack.records.length);
    expect(pack.contacts.every((contact) => (
      contact.sourceKey.length <= 300
      && contact.name.length <= 200
      && (contact.phone?.length ?? 0) <= 120
      && (contact.email?.length ?? 0) <= 320
      && (contact.orgName?.length ?? 0) <= 200
      && (contact.source?.length ?? 0) <= 500
      && (contact.notes?.length ?? 0) <= 5_000
      && Buffer.byteLength(JSON.stringify(contact.metadata), "utf8") <= 32_768
    ))).toBe(true);
    expect(pack.records.every((record) => (
      record.sourceKey.length <= 300
      && record.title.length <= 200
      && (record.status?.length ?? 0) <= 80
      && Buffer.byteLength(JSON.stringify(record.payload), "utf8") <= 32_768
    ))).toBe(true);
  });
});
