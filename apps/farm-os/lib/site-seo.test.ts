import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { SITE_CONTENT_DEFAULTS, type Lang } from "@/lib/site-content";
import {
  SITE_ORIGIN,
  SITE_PATH,
  serializeJsonLd,
  siteJsonLd,
  siteMetadata,
} from "@/lib/site-seo";

const homePage = readFileSync(resolve(__dirname, "../app/(public-ar)/page.tsx"), "utf8");
const englishPage = readFileSync(resolve(__dirname, "../app/(public-en)/en/page.tsx"), "utf8");
const seoHelper = readFileSync(resolve(__dirname, "./site-seo.ts"), "utf8");

/**
 * Minimal robots.txt evaluator following Google's rule: the most specific (longest) matching
 * rule wins, ties go to Allow. `$` anchors the end of the path; nothing here uses `*`.
 */
function robotsAllows(path: string): boolean {
  const { rules } = robots();
  const group = Array.isArray(rules) ? rules[0] : rules;
  const toList = (v: string | string[] | undefined) =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const longestMatch = (patterns: string[]) =>
    patterns.reduce((best, pattern) => {
      const anchored = pattern.endsWith("$");
      const prefix = anchored ? pattern.slice(0, -1) : pattern;
      const hit = anchored ? path === prefix : path.startsWith(prefix);
      return hit && prefix.length > best ? prefix.length : best;
    }, -1);

  const allow = longestMatch(toList(group.allow));
  const disallow = longestMatch(toList(group.disallow));
  return allow >= disallow;
}

describe("public site SEO signals", () => {
  it("declares a per-language canonical with the full hreflang set on both routes", () => {
    for (const lang of ["ar", "en"] as Lang[]) {
      const { alternates } = siteMetadata(lang);
      expect(alternates?.canonical).toBe(SITE_PATH[lang]);
      expect(alternates?.languages).toEqual({
        ar: "/",
        en: "/en",
        "x-default": "/",
      });
    }
  });

  it("keeps Arabic as the canonical home and x-default", () => {
    expect(SITE_PATH.ar).toBe("/");
    expect(siteMetadata("ar").alternates?.canonical).toBe("/");
    expect(siteMetadata("ar").alternates?.languages?.["x-default"]).toBe("/");
  });

  it("titles and describes each route in its own language, from approved content", () => {
    const ar = siteMetadata("ar");
    const en = siteMetadata("en");

    expect(ar.title).toEqual({
      absolute: `${SITE_CONTENT_DEFAULTS.brand.name.ar} · ${SITE_CONTENT_DEFAULTS.hero.headline.ar}`,
    });
    expect(ar.description).toBe(SITE_CONTENT_DEFAULTS.hero.subhead.ar);
    expect(ar.openGraph).toMatchObject({ locale: "ar_EG", alternateLocale: "en_US", url: "/" });

    expect(en.title).toEqual({
      absolute: `${SITE_CONTENT_DEFAULTS.brand.name.en} · ${SITE_CONTENT_DEFAULTS.hero.headline.en}`,
    });
    expect(en.description).toBe(SITE_CONTENT_DEFAULTS.hero.subhead.en);
    expect(en.openGraph).toMatchObject({ locale: "en_US", alternateLocale: "ar_EG", url: "/en" });

    // Arabic metadata must not be Latin-only boilerplate, and vice versa.
    expect(String(ar.description)).toMatch(/[؀-ۿ]/);
    expect(String(en.description)).not.toMatch(/[؀-ۿ]/);
  });

  it("emits one shared Organization and WebSite plus a per-language WebPage entity", () => {
    const graphOf = (lang: Lang) => siteJsonLd(lang, SITE_CONTENT_DEFAULTS)["@graph"];
    const [arOrg, arSite, arPage] = graphOf("ar");
    const [enOrg, enSite, enPage] = graphOf("en");

    expect(arOrg["@id"]).toBe(enOrg["@id"]);
    expect(arOrg["@id"]).toBe(`${SITE_ORIGIN}/#organization`);
    expect(arOrg).toMatchObject({
      "@type": "Organization",
      name: SITE_CONTENT_DEFAULTS.brand.name.ar,
      alternateName: SITE_CONTENT_DEFAULTS.brand.name.en,
      legalName: SITE_CONTENT_DEFAULTS.brand.registeredName.ar,
      description: SITE_CONTENT_DEFAULTS.hero.subhead.ar,
      email: SITE_CONTENT_DEFAULTS.contact.email,
      telephone: "+201002174773",
    });
    expect(enOrg).toMatchObject({
      name: SITE_CONTENT_DEFAULTS.brand.name.en,
      alternateName: SITE_CONTENT_DEFAULTS.brand.name.ar,
      description: SITE_CONTENT_DEFAULTS.hero.subhead.en,
    });

    expect(arSite).toEqual(enSite);
    expect(arSite).toMatchObject({
      "@type": "WebSite",
      url: `${SITE_ORIGIN}/`,
      inLanguage: ["ar", "en"],
      publisher: { "@id": arOrg["@id"] },
    });
    expect(arPage).toMatchObject({
      "@type": "WebPage",
      url: `${SITE_ORIGIN}/`,
      inLanguage: "ar",
      isPartOf: { "@id": arSite["@id"] },
    });
    expect(enPage).toMatchObject({
      "@type": "WebPage",
      url: `${SITE_ORIGIN}/en`,
      inLanguage: "en",
      isPartOf: { "@id": enSite["@id"] },
    });
  });

  it("never fabricates commerce rich-result data", () => {
    // Google's Product rich result requires visible offer or review data; the site publishes
    // none, so no Product/Offer/rating entity may appear in the JSON-LD or the helper.
    for (const lang of ["ar", "en"] as Lang[]) {
      const json = JSON.stringify(siteJsonLd(lang, SITE_CONTENT_DEFAULTS));
      for (const banned of ["Product", "Offer", "AggregateRating", "Review", "price"]) {
        expect(json).not.toContain(banned);
      }
    }
    expect(seoHelper).not.toMatch(/"@type":\s*"(Product|Offer|AggregateRating|Review)"/);
  });

  it("takes its JSON-LD contact values from owner-managed content, not hardcoded copies", () => {
    const edited = {
      ...SITE_CONTENT_DEFAULTS,
      contact: {
        ...SITE_CONTENT_DEFAULTS.contact,
        email: "export@example.com",
        phones: ["+20 111 222 3333"],
        address: { ar: "عنوان محدث", en: "Updated farm address" },
      },
    };
    const [org] = siteJsonLd("en", edited)["@graph"];
    expect(org).toMatchObject({
      email: "export@example.com",
      telephone: "+201112223333",
      address: { streetAddress: "Updated farm address", addressCountry: "EG" },
    });
  });

  it("serializes hostile owner text without permitting an inline-script breakout", () => {
    const hostile = "</script><img src=x onerror=alert(1)>&\u2028\u2029";
    const edited = {
      ...SITE_CONTENT_DEFAULTS,
      brand: {
        ...SITE_CONTENT_DEFAULTS.brand,
        name: { ...SITE_CONTENT_DEFAULTS.brand.name, en: hostile },
      },
    };
    const value = siteJsonLd("en", edited);
    const serialized = serializeJsonLd(value);

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(JSON.parse(serialized)).toEqual(value);
    expect(homePage).toContain("serializeJsonLd(siteJsonLd(\"ar\", content))");
    expect(englishPage).toContain("serializeJsonLd(siteJsonLd(\"en\", content))");
  });

  it("wires both pages to the shared helper with their own language", () => {
    expect(homePage).toContain('siteMetadata("ar", await loadSiteContent())');
    expect(homePage).toContain('siteJsonLd("ar", content)');
    expect(homePage).toContain('<SiteLanding content={content} lang="ar" />');
    expect(englishPage).toContain('siteMetadata("en", await loadSiteContent())');
    expect(englishPage).toContain('siteJsonLd("en", content)');
    expect(englishPage).toContain('<SiteLanding content={content} lang="en" />');
    // Neither page may re-declare metadata or JSON-LD locally.
    expect(homePage).not.toContain('"@context"');
    expect(englishPage).not.toContain('"@context"');
  });
});

describe("robots and noindex compatibility", () => {
  it("allows crawlers to request the public pages", () => {
    expect(robotsAllows("/")).toBe(true);
    expect(robotsAllows("/en")).toBe(true);
  });

  it("allows the immutable Next.js assets needed to render the pages", () => {
    expect(robotsAllows("/_next/static/css/site.css")).toBe(true);
    expect(robotsAllows("/_next/static/chunks/app/page.js")).toBe(true);
    expect(robotsAllows("/_next/image?url=private")).toBe(true);
  });

  it("allows crawlers to fetch private route responses and observe their X-Robots-Tag", () => {
    for (const path of [
      "/dashboard",
      "/login",
      "/settings/analytics",
      "/accounting",
      "/people",
      "/api/finance/statements.pdf",
      "/website",
      "/reset-password",
      "/en/dashboard",
      "/enquiries",
    ]) {
      expect(robotsAllows(path), path).toBe(true);
    }
  });

  it("does not block the crawler before the response-level noindex policy can run", () => {
    const { rules } = robots();
    const group = Array.isArray(rules) ? rules[0] : rules;
    expect(group.allow).toBe("/");
    expect(group.disallow).toBeUndefined();
  });
});

describe("sitemap coverage", () => {
  it("lists both public routes with matching language alternates", () => {
    const entries = sitemap();
    expect(entries.map((e) => e.url)).toEqual([`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/en`]);
    for (const entry of entries) {
      expect(entry.alternates?.languages).toEqual({
        ar: `${SITE_ORIGIN}/`,
        en: `${SITE_ORIGIN}/en`,
        "x-default": `${SITE_ORIGIN}/`,
      });
    }
  });

  it("lists no private route", () => {
    for (const entry of sitemap()) {
      expect(["/", "/en"]).toContain(new URL(entry.url).pathname);
    }
  });
});
