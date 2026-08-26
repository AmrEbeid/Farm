import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { SITE_CONTENT_DEFAULTS, type Lang } from "@/lib/site-content";
import {
  PUBLIC_SITE_PAGES,
  PUBLIC_SITE_PAGE_KEYS,
  SITE_PUBLIC_PATHS,
} from "@/lib/site-public-pages";
import {
  SITE_ORIGIN,
  SITE_PATH,
  serializeJsonLd,
  siteJsonLd,
  siteMetadata,
  sitePageJsonLd,
  sitePageMetadata,
} from "@/lib/site-seo";

const homePage = readFileSync(
  resolve(__dirname, "../app/(public-ar)/page.tsx"),
  "utf8"
);
const englishPage = readFileSync(
  resolve(__dirname, "../app/(public-en)/en/page.tsx"),
  "utf8"
);
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
      absolute: "مزرعة عبيد | تمور برحي طازجة من الشرقية",
    });
    expect(ar.description).toBe(
      "تمور برحي طازجة من مزرعة عبيد بالشرقية، مع معلومات المنتج ومواصفات التوريد ووسائل التواصل التي تديرها المزرعة من داخل نظامها."
    );
    expect(ar.openGraph).toMatchObject({
      locale: "ar_EG",
      alternateLocale: "en_US",
      url: "/",
    });

    expect(en.title).toEqual({
      absolute: "Ebeid Farm | Fresh Barhi Dates from Egypt",
    });
    expect(en.description).toBe(
      "Fresh Barhi dates from Ebeid Farm in El-Sharkia, Egypt, with owner-managed product information, supply specifications and contact details."
    );
    expect(en.openGraph).toMatchObject({
      locale: "en_US",
      alternateLocale: "ar_EG",
      url: "/en",
    });

    // Arabic metadata must not be Latin-only boilerplate, and vice versa.
    expect(String(ar.description)).toMatch(/[؀-ۿ]/);
    expect(String(en.description)).not.toMatch(/[؀-ۿ]/);
    expect(
      String((ar.title as { absolute: string }).absolute).length
    ).toBeLessThanOrEqual(60);
    expect(
      String((en.title as { absolute: string }).absolute).length
    ).toBeLessThanOrEqual(60);
    expect(String(ar.description).length).toBeLessThanOrEqual(170);
    expect(String(en.description).length).toBeLessThanOrEqual(170);
  });

  it("gives every focused page concise localized metadata and exact reciprocal alternates", () => {
    for (const page of PUBLIC_SITE_PAGE_KEYS) {
      const definition = PUBLIC_SITE_PAGES[page];
      for (const lang of ["ar", "en"] as Lang[]) {
        const metadata = sitePageMetadata(lang, page);
        expect(metadata.title).toEqual({ absolute: definition.title[lang] });
        expect(metadata.description).toBe(definition.description[lang]);
        expect(metadata.alternates).toEqual({
          canonical: definition.path[lang],
          languages: {
            ar: definition.path.ar,
            en: definition.path.en,
            "x-default": definition.path.ar,
          },
        });
        expect(definition.title[lang].length).toBeLessThanOrEqual(65);
        expect(definition.description[lang].length).toBeLessThanOrEqual(180);
      }
    }
  });

  it("defines the required public page contract for every focused buyer intent", () => {
    for (const page of PUBLIC_SITE_PAGE_KEYS) {
      const pageMeta = PUBLIC_SITE_PAGES[page].pageMeta;
      for (const field of [
        "what",
        "why",
        "when",
        "how",
        "commonMistakes",
      ] as const) {
        expect(pageMeta[field].ar.trim().length).toBeGreaterThan(0);
        expect(pageMeta[field].en.trim().length).toBeGreaterThan(0);
      }
      expect(pageMeta.permissions).toEqual(["public"]);
      expect(pageMeta.spec).toBe(
        "docs/superpowers/specs/2026-07-03-public-website-design.md"
      );
    }
  });

  it("emits one shared Organization and WebSite plus a per-language WebPage entity", () => {
    const graphOf = (lang: Lang) =>
      siteJsonLd(lang, SITE_CONTENT_DEFAULTS)["@graph"];
    const [arOrg, arSite, arPage] = graphOf("ar");
    const [enOrg, enSite, enPage] = graphOf("en");

    expect(arOrg["@id"]).toBe(enOrg["@id"]);
    expect(arOrg["@id"]).toBe(`${SITE_ORIGIN}/#organization`);
    expect(arOrg).toMatchObject({
      "@type": "Organization",
      name: SITE_CONTENT_DEFAULTS.brand.name.ar,
      alternateName: SITE_CONTENT_DEFAULTS.brand.name.en,
      legalName: SITE_CONTENT_DEFAULTS.brand.registeredName.ar,
      description: siteMetadata("ar").description,
      email: SITE_CONTENT_DEFAULTS.contact.email,
      telephone: "+201002174773",
    });
    expect(enOrg).toMatchObject({
      name: SITE_CONTENT_DEFAULTS.brand.name.en,
      alternateName: SITE_CONTENT_DEFAULTS.brand.name.ar,
      description: siteMetadata("en").description,
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
      for (const banned of [
        "Product",
        "Offer",
        "AggregateRating",
        "Review",
        "price",
      ]) {
        expect(json).not.toContain(banned);
      }
      for (const page of PUBLIC_SITE_PAGE_KEYS) {
        const detailJson = JSON.stringify(
          sitePageJsonLd(lang, page, SITE_CONTENT_DEFAULTS)
        );
        for (const banned of [
          "Product",
          "Offer",
          "AggregateRating",
          "Review",
          "price",
        ]) {
          expect(detailJson).not.toContain(banned);
        }
      }
    }
    expect(seoHelper).not.toMatch(
      /"@type":\s*"(Product|Offer|AggregateRating|Review)"/
    );
  });

  it("emits a localized WebPage entity for every focused route", () => {
    for (const page of PUBLIC_SITE_PAGE_KEYS) {
      for (const lang of ["ar", "en"] as Lang[]) {
        const graph = sitePageJsonLd(lang, page, SITE_CONTENT_DEFAULTS)[
          "@graph"
        ];
        const webpage = graph[2];
        expect(webpage).toMatchObject({
          "@type": "WebPage",
          url: `${SITE_ORIGIN}${PUBLIC_SITE_PAGES[page].path[lang]}`,
          name: PUBLIC_SITE_PAGES[page].heading[lang],
          description: PUBLIC_SITE_PAGES[page].description[lang],
          inLanguage: lang,
        });
      }
    }
  });

  it("fails closed in visible metadata and JSON-LD when no certificate proof is published", () => {
    const withoutProofs = {
      ...SITE_CONTENT_DEFAULTS,
      certifications: { ...SITE_CONTENT_DEFAULTS.certifications, items: [] },
    };
    for (const page of ["chinaSupply", "certifications"] as const) {
      const metadata = sitePageMetadata("en", page, withoutProofs);
      const webpage = sitePageJsonLd("en", page, withoutProofs)["@graph"][2];
      expect(
        String((metadata.title as { absolute: string }).absolute)
      ).not.toContain("Eligible");
      expect(String(metadata.description)).toContain(
        "No certificate is currently published"
      );
      expect(webpage.name).not.toContain("Eligible");
      expect(webpage.description).toContain(
        "No certificate is currently published"
      );
    }
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
    expect(homePage).toContain('serializeJsonLd(siteJsonLd("ar", content))');
    expect(englishPage).toContain('serializeJsonLd(siteJsonLd("en", content))');
  });

  it("wires both pages to the shared helper with their own language", () => {
    expect(homePage).toContain('siteMetadata("ar", await loadSiteContent())');
    expect(homePage).toContain('siteJsonLd("ar", content)');
    expect(homePage).toContain('<SiteLanding content={content} lang="ar" />');
    expect(englishPage).toContain(
      'siteMetadata("en", await loadSiteContent())'
    );
    expect(englishPage).toContain('siteJsonLd("en", content)');
    expect(englishPage).toContain(
      '<SiteLanding content={content} lang="en" />'
    );
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
  it("lists every public route once with the matching language pair", () => {
    const entries = sitemap();
    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual(
      SITE_PUBLIC_PATHS
    );
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(
      SITE_PUBLIC_PATHS.length
    );

    for (const page of PUBLIC_SITE_PAGE_KEYS) {
      const definition = PUBLIC_SITE_PAGES[page];
      const expectedLanguages = {
        ar: `${SITE_ORIGIN}${definition.path.ar}`,
        en: `${SITE_ORIGIN}${definition.path.en}`,
        "x-default": `${SITE_ORIGIN}${definition.path.ar}`,
      };
      for (const path of [definition.path.ar, definition.path.en]) {
        const entry = entries.find(
          (candidate) => new URL(candidate.url).pathname === path
        );
        expect(entry?.alternates?.languages).toEqual(expectedLanguages);
      }
    }
  });

  it("lists no private route", () => {
    for (const entry of sitemap()) {
      expect(SITE_PUBLIC_PATHS).toContain(new URL(entry.url).pathname);
      expect(new URL(entry.url).pathname).not.toMatch(
        /^\/(dashboard|finance|settings|api|login)/
      );
    }
  });
});
