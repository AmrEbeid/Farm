import "server-only";
import { createHash } from "node:crypto";
import { extractMarketingSource } from "./source-extractor";
import { buildMarketingSourcePack, type MarketingSourcePack } from "./source-pack";
import { MARKETING_SOURCE_AREAS } from "./source-areas";

export const MARKETING_SOURCE_MAX_HTML_BYTES = 2_000_000;
export const MARKETING_SOURCE_MAX_STATE_BYTES = 200_000;
export const REVIEWED_MARKETING_SOURCE_DIGEST = "fb458c2865422b0ea3782894f21cae55f99278722ee3211143515155ddf9f9a6";

export interface PreparedMarketingSource {
  digest: string;
  pack: MarketingSourcePack;
  summary: {
    contacts: number;
    selectedContacts: number;
    records: number;
    tabs: number;
    templates: number;
    mutableStateKeys: number;
    recordTypes: Record<string, number>;
    excluded: MarketingSourcePack["coverage"]["mappedElsewhere"];
    emptyRegisters: string[];
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function prepareMarketingSource(html: string, state: string): PreparedMarketingSource {
  if (byteLength(html) > MARKETING_SOURCE_MAX_HTML_BYTES) {
    throw new Error("Marketing HTML source exceeds the 2 MB limit");
  }
  if (byteLength(state) > MARKETING_SOURCE_MAX_STATE_BYTES) {
    throw new Error("Marketing state source exceeds the 200 KB limit");
  }

  const manifest = extractMarketingSource(html, state);
  const expectedAreaIds = MARKETING_SOURCE_AREAS.map((area) => area.sourceId);
  const actualAreaIds = manifest.tabs.map((tab) => tab.id);
  if (JSON.stringify(actualAreaIds) !== JSON.stringify(expectedAreaIds)) {
    throw new Error("Marketing source areas do not match the reviewed 25-area contract");
  }

  const pack = buildMarketingSourcePack(manifest);
  const recordTypes = Object.fromEntries(
    [...new Set(pack.records.map((record) => record.recordType))]
      .sort()
      .map((recordType) => [
        recordType,
        pack.records.filter((record) => record.recordType === recordType).length,
      ]),
  );
  const digest = createHash("sha256")
    .update("farm-marketing-source-v1\0", "utf8")
    .update(html, "utf8")
    .update("\0", "utf8")
    .update(state, "utf8")
    .digest("hex");

  return {
    digest,
    pack,
    summary: {
      contacts: pack.contacts.length,
      selectedContacts: pack.contacts.filter((contact) => contact.selected).length,
      records: pack.records.length,
      tabs: pack.coverage.tabs.length,
      templates: pack.coverage.templates,
      mutableStateKeys: pack.coverage.mutableStateKeys.length,
      recordTypes,
      excluded: pack.coverage.mappedElsewhere,
      emptyRegisters: pack.coverage.emptyRegisters,
    },
  };
}
