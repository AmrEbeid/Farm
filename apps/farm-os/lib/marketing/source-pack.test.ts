import { describe, expect, it } from "vitest";
import { buildMarketingSourcePack } from "./source-pack";
import type { MarketingSourceManifest } from "./source-extractor";

function manifest(): MarketingSourceManifest {
  return {
    version: 1,
    tabs: [{ id: "dashboard", label: "لوحة" }],
    templates: [{ id: "mailTemplate", body: "Hello" }],
    datasets: {
      FARM_FACTS: { farmAreaFeddan: 120 },
      EXPORTERS: [{ "الاسم": "Same Co", "الإيميل": "sales@example.com", "الهاتف": "0100", "المصدر": "curated" }],
      PRICE_TYPES: ["EXW"],
      CONTACTS: [{ id: 2, company: "Same Co", email: "sales@example.com", phones: "01001234567", source: "directory" }],
      B2B_PLATFORMS: [{ name: "Alibaba", url: "https://alibaba.com" }],
      CERT_DEFS: [{ id: "gap", name: "GlobalGAP" }],
      FIN_CHANNELS: ["الكويت"],
      FREIGHT_RATES: [{ label: "جوي", market: "الكويت", rate: "مرجعي" }],
      KUWAIT_DISTRIBUTORS: [{ name: "K Co", email: "k@example.com", source: "kuwait" }],
    },
    loadDefaults: {
      ep_prices: [{ date: "2026-08-01", type: "EXW", low: 10, high: 20 }],
      ep_offshoot_leads: [{ buyer: "Lead", stage: "new" }],
    },
    savedState: {
      ep_csel: "[2]",
      ep_prices: "[]",
      ep_tasks: "[true,false,false,false,false,false]",
      ep_platform_tasks: "[false,false,false,false,false,false]",
      ep_kuwait_dist_status: '{"0":"تم التواصل"}',
      ep_kuwait_dist_notes: '{"0":"اتصال ناجح"}',
      ep_li: '{"farmUrl":"https://ebeidfarm.business/"}',
      ep_finance: '{"الكويت":{"target":"100"}}',
    },
    coverage: {
      tabs: 1,
      templates: 1,
      stateKeys: 8,
      datasets: { FARM_FACTS: 1, EXPORTERS: 1, PRICE_TYPES: 1, CONTACTS: 1, B2B_PLATFORMS: 1, CERT_DEFS: 1, FIN_CHANNELS: 1, FREIGHT_RATES: 1, KUWAIT_DISTRIBUTORS: 1 },
      loadDefaults: { ep_prices: 1, ep_offshoot_leads: 1 },
    },
  };
}

describe("buildMarketingSourcePack", () => {
  it("deduplicates contacts while preserving source rows and selected state", () => {
    const pack = buildMarketingSourcePack(manifest());
    expect(pack.contacts).toHaveLength(2);
    const same = pack.contacts.find((contact) => contact.email?.includes("sales@example.com"));
    expect(same?.selected).toBe(true);
    expect(same?.metadata.sourceKeys).toEqual([
      "source2026:exporter:1",
      "source2026:directory:2",
    ]);
    expect(same?.metadata.sourceRows).toHaveLength(2);
  });

  it("does not use a shared source-list label as a contact identity", () => {
    const source = manifest();
    source.datasets.EXPORTERS = [
      { "الاسم": "Exporter One", "المصدر": "قائمة مشتركة" },
      { "الاسم": "Exporter Two", "المصدر": "قائمة مشتركة" },
    ];
    source.datasets.CONTACTS = [];
    source.datasets.KUWAIT_DISTRIBUTORS = [];

    const pack = buildMarketingSourcePack(source);

    expect(pack.contacts.map((contact) => contact.name)).toEqual([
      "Exporter One",
      "Exporter Two",
    ]);
  });

  it("does not merge distinct companies that share a generic directory website", () => {
    const source = manifest();
    source.datasets.EXPORTERS = [
      { "الاسم": "Exporter One", "الموقع": "https://example-directory.test/suppliers" },
      { "الاسم": "Exporter Two", "الموقع": "https://example-directory.test/suppliers" },
    ];
    source.datasets.CONTACTS = [];
    source.datasets.KUWAIT_DISTRIBUTORS = [];

    expect(buildMarketingSourcePack(source).contacts.map((contact) => contact.name)).toEqual([
      "Exporter One",
      "Exporter Two",
    ]);
  });

  it("maps every static source family and editable saved state", () => {
    const pack = buildMarketingSourcePack(manifest());
    expect(pack.records.map((record) => record.recordType)).toEqual(expect.arrayContaining([
      "message_template", "platform_state", "certificate", "freight_reference",
      "market_reference", "channel_target", "price_observation", "lead_offshoot", "task",
    ]));
    expect(pack.records.find((record) => record.sourceKey === "source2026:channel-target:الكويت")?.amount).toBe(100);
    expect(pack.contacts.find((contact) => contact.category === "kuwait_distributor")?.notes)
      .toBe("تم التواصل - اتصال ناجح");
  });

  it("records authoritative exclusions and empty workflows explicitly", () => {
    const pack = buildMarketingSourcePack(manifest());
    expect(pack.coverage.mappedElsewhere.map((entry) => entry.source)).toEqual([
      "ep_harvest_log",
      "ep_owner_whatsapp",
      "FARM_FACTS.palmsApprox",
    ]);
    expect(pack.records.find((record) => record.sourceKey === "source2026:farm-facts")?.payload)
      .not.toHaveProperty("palmsApprox");
    expect(pack.coverage.emptyRegisters).toContain("ep_daily_sales_reports");
    expect(pack.coverage.tabs).toEqual(["dashboard"]);
  });
});
