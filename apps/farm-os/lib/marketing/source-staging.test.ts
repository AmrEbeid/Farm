import { describe, expect, it } from "vitest";
import { stageMarketingSource, validateStagedMarketingRecords } from "./source-staging";

const unrelated = {
  farm_work_manager_offline_v4: "{}",
  farm_work_manager_offline_v2: "{}",
  ebeidTasks: "[]",
  ebeid_farm_light_html_v1: "{}",
  farm_work_manager_offline_v5: "{}",
  farm_tracker_v3: "{}",
  farm_work_manager_offline_v3: "{}",
  ebeid_farm_v2: "{}",
  expense_app_offline_ar_v1: "{}",
};

function actualLegacyExport() {
  return {
    ...unrelated,
    ep_prices: JSON.stringify([
      { date: "2026-08-01", type: "عبور — برحي (إخباري)", low: 35, high: 65, note: "تقرير إخباري — غير رسمي" },
      { date: "2026-08-09", type: "عبور — برحي (إخباري)", low: "40", high: "70", note: "سؤال" },
      { date: "2026-08-16", type: "عبور — برحي (إخباري)", low: "35", high: "55", note: "سؤال" },
    ]),
    ep_finance: JSON.stringify({ "تصدير مباشر (عبر مصدّرين/وسطاء)": { target: "0" } }),
    ep_tasks: JSON.stringify([false, false, false, false, false, false]),
    ep_platform_tasks: JSON.stringify([false, false, false, false, false, false]),
    ep_kuwait_dist_status: JSON.stringify({ 4: "تم التواصل", 8: "تم التواصل", 13: "تم التواصل" }),
    ep_csel: JSON.stringify([2, 4]),
    ep_owner_whatsapp: JSON.stringify("01151052270"),
    ep_harvest_log: "[]",
    ep_li: JSON.stringify({ farmUrl: "https://ebeidfarm.business/" }),
  };
}

describe("stageMarketingSource", () => {
  it("understands the actual ep_* export and rejects the nine unrelated app keys", () => {
    const result = stageMarketingSource(actualLegacyExport());
    expect(result.ok).toBe(true);
    expect(result.rejectedKeys).toEqual(Object.keys(unrelated));
  });

  it("preserves the verified source inventory as counts only", () => {
    expect(stageMarketingSource(actualLegacyExport()).inventory).toEqual({
      exporters: 75, contacts: 1513, kuwaitDistributors: 14, platforms: 28, freightRefs: 12,
    });
  });

  it("maps the actual saved state without importing harvest or raw static lists", () => {
    const result = stageMarketingSource(actualLegacyExport());
    expect(result.counts).toEqual({
      prices: 3, kuwaitStatuses: 3, selectedContacts: 2, harvest: 0,
      campaignTasks: 6, platformTasks: 6, target: 0,
    });
    expect(result.records).toHaveLength(25);
    expect(JSON.stringify(result.records)).not.toContain("farm_work_manager_offline");
  });

  it("maps selected IDs and Kuwait indices to the source entities", () => {
    const names = stageMarketingSource(actualLegacyExport()).records
      .filter((record) => record.kind === "contact")
      .map((record) => record.name);
    expect(names).toEqual([
      "السعداوي للإستيراد والتصدير", "جرين فارم للحاصلات الزراعية",
      "Jawad & Majed Company", "Fresh Vibes Trading", "AgroFoods Global",
    ]);
  });

  it("is deterministic and gives every row a unique persisted provenance key", () => {
    const first = stageMarketingSource(actualLegacyExport());
    expect(stageMarketingSource(actualLegacyExport())).toEqual(first);
    expect(new Set(first.records.map((record) => record.provenanceKey)).size).toBe(first.records.length);
    expect(validateStagedMarketingRecords(first.records)).toBe(true);
  });

  it("rejects malformed nested JSON and non-empty legacy harvest data", () => {
    expect(stageMarketingSource({ ...actualLegacyExport(), ep_prices: "not-json" }).ok).toBe(false);
    expect(stageMarketingSource({ ...actualLegacyExport(), ep_harvest_log: "[{\"kg\":10}]" }).ok).toBe(false);
  });

  it("rejects oversized or client-invented staged import batches", () => {
    const records = stageMarketingSource(actualLegacyExport()).records;
    expect(validateStagedMarketingRecords([...records, { kind: "record", provenanceKey: "manual:x" }])).toBe(false);
    expect(validateStagedMarketingRecords(new Array(101).fill(records[0]))).toBe(false);
  });
});
