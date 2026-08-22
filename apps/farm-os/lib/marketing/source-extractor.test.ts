import { describe, expect, it } from "vitest";
import { extractMarketingSource } from "./source-extractor";

const datasetDeclarations = `
const FARM_FACTS = { area: 120 };
const EXPORTERS = [{ name: "A" }];
const PRICE_TYPES = ["farm"];
const CONTACTS = [{ id: 1 }];
const B2B_PLATFORMS = [{ name: "P" }];
const CERT_DEFS = [{ name: "C" }];
const FIN_CHANNELS = ["direct"];
const FREIGHT_RATES = [{ route: "A-B" }];
const KUWAIT_DISTRIBUTORS = [{ name: "K" }];
const OFF_KEY = "ep_offshoot_leads";
load("ep_prices", [{ low: 1, high: 2 }]);
load(OFF_KEY, [{ name: "Lead" }]);
load("ep_crm", { 1: "تم التواصل" });
load("ep_crm", { 1: "تم التواصل" });
`;

const fixture = `
<button data-tab="dashboard">لوحة التحكم</button>
<textarea id="mail">Hello &amp; welcome</textarea>
<script>${datasetDeclarations}</script>
`;

describe("extractMarketingSource", () => {
  it("extracts literal datasets, state, navigation, templates, and load defaults without executing source", () => {
    const manifest = extractMarketingSource(fixture, '{"ep_prices":"[]"}');
    expect(manifest.version).toBe(1);
    expect(manifest.tabs).toEqual([{ id: "dashboard", label: "لوحة التحكم" }]);
    expect(manifest.templates).toEqual([{ id: "mail", body: "Hello & welcome" }]);
    expect(manifest.coverage.datasets.EXPORTERS).toBe(1);
    expect(manifest.coverage.loadDefaults).toEqual({ ep_prices: 1, ep_offshoot_leads: 1, ep_crm: 1 });
    expect(manifest.loadDefaults.ep_crm).toEqual({ 1: "تم التواصل" });
    expect(manifest.savedState).toEqual({ ep_prices: "[]" });
  });

  it("fails closed when a required declaration is missing", () => {
    expect(() => extractMarketingSource(fixture.replace("const CONTACTS", "const MISSING"), "{}"))
      .toThrow("Missing required dataset declaration: CONTACTS");
  });

  it("fails closed on executable or unsupported dataset syntax", () => {
    expect(() => extractMarketingSource(fixture.replace('[{ name: "A" }]', "buildExporters()"), "{}"))
      .toThrow("Unsupported literal syntax");
  });

  it("rejects invalid state JSON", () => {
    expect(() => extractMarketingSource(fixture, "not-json")).toThrow("not valid JSON");
  });

  it("rejects conflicting defaults for the same concrete state key", () => {
    expect(() => extractMarketingSource(fixture.replace(
      'load("ep_crm", { 1: "تم التواصل" });\nload("ep_crm", { 1: "تم التواصل" });',
      'load("ep_crm", {});\nload("ep_crm", { 1: "تم التواصل" });',
    ), "{}"))
      .toThrow("Conflicting load defaults: ep_crm");
  });
});
