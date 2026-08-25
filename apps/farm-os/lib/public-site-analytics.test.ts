import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track } from "@vercel/analytics";
import {
  keepPublicHomepageOnly,
  trackPublicSiteAction,
} from "@/components/site/PublicSiteAnalytics";

const homePage = readFileSync(resolve(__dirname, "../app/page.tsx"), "utf8");
const rootLayout = readFileSync(resolve(__dirname, "../app/layout.tsx"), "utf8");
const landing = readFileSync(resolve(__dirname, "../components/site/SiteLanding.tsx"), "utf8");

describe("public website analytics", () => {
  it("runs on the public homepage without tracking the authenticated application", () => {
    expect(homePage).toContain("<PublicSiteAnalytics />");
    expect(rootLayout).not.toContain("PublicSiteAnalytics");
    expect(rootLayout).not.toContain("@vercel/analytics");
  });

  it("drops internal routes and strips query values from the public URL", () => {
    vi.stubGlobal("window", { location: { origin: "https://ebeidfarm.business" } });

    expect(
      keepPublicHomepageOnly({
        type: "pageview",
        url: "https://ebeidfarm.business/?email=buyer%40example.com#contact",
      }),
    ).toEqual({ type: "pageview", url: "https://ebeidfarm.business/" });
    expect(
      keepPublicHomepageOnly({ type: "pageview", url: "https://ebeidfarm.business/dashboard" }),
    ).toBeNull();
    expect(
      keepPublicHomepageOnly({ type: "pageview", url: "https://example.com/" }),
    ).toBeNull();

    vi.unstubAllGlobals();
  });

  it("tracks useful conversion labels without sending contact or enquiry fields", () => {
    for (const action of [
      "certificate_opened",
      "contact_email",
      "contact_phone",
      "contact_whatsapp",
      "enquiry_submitted",
    ]) {
      expect(landing).toContain(`trackPublicSiteAction(\"${action}\"`);
    }
    for (const action of [
      "contact_email",
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
});
