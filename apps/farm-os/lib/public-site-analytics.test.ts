import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track } from "@vercel/analytics";
import {
  keepPublicSiteOnly,
  trackPublicSiteAction,
} from "@/components/site/PublicSiteAnalytics";

const homePage = readFileSync(resolve(__dirname, "../app/(public-ar)/page.tsx"), "utf8");
const englishPage = readFileSync(resolve(__dirname, "../app/(public-en)/en/page.tsx"), "utf8");
const rootDocument = readFileSync(resolve(__dirname, "../app/root-document.tsx"), "utf8");
const landing = readFileSync(resolve(__dirname, "../components/site/SiteLanding.tsx"), "utf8");
const analyticsPage = readFileSync(
  resolve(__dirname, "../app/(app)/settings/analytics/page.tsx"),
  "utf8",
);

describe("public website analytics", () => {
  it("runs on both public language pages without tracking the authenticated application", () => {
    expect(homePage).toContain("<PublicSiteAnalytics />");
    expect(englishPage).toContain("<PublicSiteAnalytics />");
    expect(rootDocument).not.toContain("PublicSiteAnalytics");
    expect(rootDocument).not.toContain("@vercel/analytics");
  });

  it("keeps both public routes and drops internal routes, stripping query values", () => {
    vi.stubGlobal("window", { location: { origin: "https://ebeidfarm.business" } });

    expect(
      keepPublicSiteOnly({
        type: "pageview",
        url: "https://ebeidfarm.business/?email=buyer%40example.com#contact",
      }),
    ).toEqual({ type: "pageview", url: "https://ebeidfarm.business/" });
    expect(
      keepPublicSiteOnly({
        type: "pageview",
        url: "https://ebeidfarm.business/en?utm_source=buyer#contact",
      }),
    ).toEqual({ type: "pageview", url: "https://ebeidfarm.business/en" });
    expect(
      keepPublicSiteOnly({ type: "pageview", url: "https://ebeidfarm.business/dashboard" }),
    ).toBeNull();
    expect(
      keepPublicSiteOnly({ type: "pageview", url: "https://ebeidfarm.business/enquiries" }),
    ).toBeNull();
    expect(
      keepPublicSiteOnly({ type: "pageview", url: "https://example.com/" }),
    ).toBeNull();

    vi.unstubAllGlobals();
  });

  it("tracks useful conversion labels without sending contact or enquiry fields", () => {
    for (const action of [
      "certificate_opened",
      "contact_email",
      "contact_location",
      "contact_phone",
      "contact_whatsapp",
      "enquiry_submitted",
    ]) {
      expect(landing).toContain(`trackPublicSiteAction(\"${action}\"`);
    }
    for (const action of [
      "contact_email",
      "contact_location",
      "contact_phone",
      "contact_whatsapp",
      "enquiry_submitted",
    ]) {
      expect(landing).not.toContain(`trackPublicSiteAction(\"${action}\", lang,`);
    }
    expect(landing).toContain(
      'trackPublicSiteAction("certificate_opened", lang, { certificate: i + 1 })',
    );
  });

  it("sends only the allow-listed action properties to Vercel", () => {
    trackPublicSiteAction("certificate_opened", "ar", { certificate: 2 });
    trackPublicSiteAction("enquiry_submitted", "en");

    expect(track).toHaveBeenNthCalledWith(1, "certificate_opened", {
      language: "ar",
      certificate: 2,
    });
    expect(track).toHaveBeenNthCalledWith(2, "enquiry_submitted", { language: "en" });
  });

  it("shows the location action with an Arabic label in the owner analytics page", () => {
    expect(analyticsPage).toContain('contact_location: "فتح موقع المزرعة"');
  });
});
