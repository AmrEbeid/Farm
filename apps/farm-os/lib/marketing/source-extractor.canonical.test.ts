import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractMarketingSource } from "./source-extractor";

const enabled = process.env.RUN_MARKETING_SOURCE_CANONICAL === "1";
const canonical = enabled ? describe : describe.skip;

canonical("canonical Marketing source extraction", () => {
  it("accounts for every pinned dataset in the supplied HTML and JSON", () => {
    const htmlPath = process.env.MARKETING_SOURCE_HTML;
    const statePath = process.env.MARKETING_SOURCE_STATE;
    if (!htmlPath || !statePath) {
      throw new Error("MARKETING_SOURCE_HTML and MARKETING_SOURCE_STATE are required when the canonical gate is enabled");
    }

    const manifest = extractMarketingSource(readFileSync(htmlPath, "utf8"), readFileSync(statePath, "utf8"));
    expect(manifest.coverage).toEqual({
      tabs: 25,
      templates: 20,
      stateKeys: 18,
      datasets: {
        FARM_FACTS: 1,
        EXPORTERS: 75,
        PRICE_TYPES: 7,
        CONTACTS: 1513,
        B2B_PLATFORMS: 28,
        CERT_DEFS: 4,
        FIN_CHANNELS: 5,
        FREIGHT_RATES: 12,
        KUWAIT_DISTRIBUTORS: 14,
      },
      loadDefaults: {
        ep_prices: 6,
        ep_tasks: 0,
        ep_bids: 0,
        ep_broker_tracking: 0,
        ep_certs: 0,
        ep_comps: 0,
        ep_crm: 0,
        ep_crm_meta: 0,
        ep_lileads: 0,
        ep_csel: 0,
        ep_csent: 0,
        ep_cstat: 0,
        ep_exw: 0,
        ep_finance: 0,
        ep_gmail: 0,
        ep_kuwait_dist_notes: 0,
        ep_kuwait_dist_status: 0,
        ep_li: 0,
        ep_owner_whatsapp: 1,
        ep_platform_state: 0,
        ep_platform_tasks: 0,
        ep_sales_floor: 0,
        ep_offshoot_leads: 2,
        ebeid_social_price_sightings_v1: 0,
        ep_local_leads: 0,
        ep_harvest_log: 0,
        ep_weekly_availability: 0,
        ep_hot_leads: 0,
        ep_daily_sales_reports: 0,
        ep_qc_log: 0,
        ep_repeat_customers: 0,
      },
    });
  });
});
