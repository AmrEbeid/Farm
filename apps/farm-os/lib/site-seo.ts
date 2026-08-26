// Localized SEO signals for the PUBLIC marketing site — shared by the Arabic/English homepages,
// focused buyer pages, robots.ts and sitemap.ts so canonicals and language pairs cannot drift.
//
// Server-safe and dependency-free on purpose: no `server-only`, no DB, no React. robots/sitemap
// (route handlers), both pages (Server Components), the analytics island (client) and the unit
// tests all import it.
//
// CONTENT RULE: every human-facing string comes from the Owner-approved `SiteContent` (the live DB
// row for JSON-LD, the typed defaults for <head> metadata, which is built without a DB read). This
// file states no new fact about the farm.
//
// NO PRODUCT MARKUP, DELIBERATELY: a Google Product rich result requires visible offer data
// (price/availability) or review/rating data. The site publishes neither — quantities are quoted per
// enquiry — so a Product/Offer/AggregateRating entity here would be fabricated. Organization +
// WebSite are the entity signals the visible page actually supports.

import type { Metadata, MetadataRoute } from "next";
import { SITE_CONTENT_DEFAULTS, type Lang, type SiteContent } from "@/lib/site-content";
import {
  PUBLIC_SITE_PAGES,
  PUBLIC_SITE_PAGE_KEYS,
  SITE_HOME_PATH,
  publicSitePageCopy,
  type PublicSitePageKey,
} from "@/lib/site-public-pages";

export const SITE_ORIGIN = "https://ebeidfarm.business";

/** The two home routes. Search-focused public routes live in site-public-pages.ts. */
export const SITE_PATH: Record<Lang, string> = SITE_HOME_PATH;

/** Text direction per language — applied to the site section wrapper. */
export const SITE_DIR: Record<Lang, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };

const OG_LOCALE: Record<Lang, string> = { ar: "ar_EG", en: "en_US" };

export function otherLang(lang: Lang): Lang {
  return lang === "ar" ? "en" : "ar";
}

/** Absolute URL of a public route (for the sitemap and JSON-LD `@id`/`url`). */
export function siteUrl(lang: Lang, page?: PublicSitePageKey): string {
  const path = page ? PUBLIC_SITE_PAGES[page].path[lang] : SITE_PATH[lang];
  return new URL(path, SITE_ORIGIN).href;
}

/**
 * canonical + hreflang. Arabic is `x-default` because `/` is the canonical home for
 * unmatched/unknown languages. Paths stay relative — the root layout's `metadataBase`
 * resolves them to absolute URLs.
 */
export function siteAlternates(
  lang: Lang,
  page?: PublicSitePageKey,
): NonNullable<Metadata["alternates"]> {
  const paths = page ? PUBLIC_SITE_PAGES[page].path : SITE_PATH;
  return {
    canonical: paths[lang],
    languages: {
      ar: paths.ar,
      en: paths.en,
      "x-default": paths.ar,
    },
  };
}

const HOME_METADATA: Record<Lang, { title: string; description: string }> = {
  ar: {
    title: "مزرعة عبيد | تمور برحي طازجة من الشرقية",
    description:
      "تمور برحي طازجة من مزرعة عبيد بالشرقية، مع معلومات المنتج ومواصفات التوريد ووسائل التواصل التي تديرها المزرعة من داخل نظامها.",
  },
  en: {
    title: "Ebeid Farm | Fresh Barhi Dates from Egypt",
    description:
      "Fresh Barhi dates from Ebeid Farm in El-Sharkia, Egypt, with owner-managed product information, supply specifications and contact details.",
  },
};

/**
 * <head> metadata for a public route, in that route's language. Built from the typed defaults
 * (not the DB) so producing metadata costs no extra read on the ISR path; the same Owner-approved
 * copy the page renders.
 */
export function siteMetadata(
  lang: Lang,
  content: SiteContent = SITE_CONTENT_DEFAULTS,
): Metadata {
  const { brand } = content;
  const metadata = HOME_METADATA[lang];
  return {
    metadataBase: new URL(SITE_ORIGIN),
    // `absolute` so the root layout's "· نظام تشغيل المزارع" template does NOT append the
    // internal app name to the public marketing pages' <title>.
    title: { absolute: metadata.title },
    description: metadata.description,
    alternates: siteAlternates(lang),
    openGraph: {
      title: metadata.title,
      description: metadata.description,
      url: SITE_PATH[lang],
      siteName: brand.name[lang],
      locale: OG_LOCALE[lang],
      alternateLocale: OG_LOCALE[otherLang(lang)],
      type: "website",
    },
  };
}

/** Metadata for one focused buyer page. Page copy is static; mutable farm facts remain in SiteContent. */
export function sitePageMetadata(
  lang: Lang,
  page: PublicSitePageKey,
  content: SiteContent = SITE_CONTENT_DEFAULTS,
): Metadata {
  const definition = PUBLIC_SITE_PAGES[page];
  const copy = publicSitePageCopy(lang, page, content);
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { absolute: copy.title },
    description: copy.description,
    alternates: siteAlternates(lang, page),
    openGraph: {
      title: copy.title,
      description: copy.description,
      url: definition.path[lang],
      siteName: content.brand.name[lang],
      locale: OG_LOCALE[lang],
      alternateLocale: OG_LOCALE[otherLang(lang)],
      type: "website",
    },
  };
}

/**
 * Organization + WebSite JSON-LD for a public route. One Organization node shared by both
 * languages (same `@id`, so search engines reconcile `/` and `/en` to ONE entity) with its
 * language-appropriate name/description, plus a per-route WebSite node carrying `inLanguage`.
 *
 * Contact/registry values (email, phone, postal address) stay in Latin in both languages — they are
 * international identifiers a buyer cross-checks, the same rule the visible page follows.
 */
export function siteJsonLd(lang: Lang, content: SiteContent) {
  return siteJsonLdForPage(lang, content);
}

function siteJsonLdForPage(
  lang: Lang,
  content: SiteContent,
  page?: PublicSitePageKey,
) {
  const organizationId = `${SITE_ORIGIN}/#organization`;
  const websiteId = `${SITE_ORIGIN}/#website`;
  const primaryPhone = (content.contact.phones[0] ?? "").replace(/[^0-9+]/g, "");
  const copy = page ? publicSitePageCopy(lang, page, content) : null;
  const pageName = copy?.heading ?? content.hero.headline[lang];
  const pageDescription = copy?.description ?? HOME_METADATA[lang].description;
  const pageUrl = siteUrl(lang, page);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: content.brand.name[lang],
        alternateName: content.brand.name[otherLang(lang)],
        legalName: content.brand.registeredName[lang],
        url: `${SITE_ORIGIN}/`,
        logo: `${SITE_ORIGIN}/icon.png`,
        image: `${SITE_ORIGIN}/opengraph-image.png`,
        description: HOME_METADATA[lang].description,
        email: content.contact.email,
        ...(primaryPhone ? { telephone: primaryPhone } : {}),
        address: {
          "@type": "PostalAddress",
          streetAddress: content.contact.address[lang],
          addressCountry: "EG",
        },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: `${SITE_ORIGIN}/`,
        name: content.brand.name.en,
        alternateName: content.brand.name.ar,
        inLanguage: ["ar", "en"],
        publisher: { "@id": organizationId },
      },
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: pageName,
        description: pageDescription,
        inLanguage: lang,
        isPartOf: { "@id": websiteId },
        about: { "@id": organizationId },
      },
    ],
  };
}

export function sitePageJsonLd(
  lang: Lang,
  page: PublicSitePageKey,
  content: SiteContent,
) {
  return siteJsonLdForPage(lang, content, page);
}

/**
 * Serialize JSON-LD for an inline script without allowing owner-managed text to terminate the
 * script element. JSON.stringify does not escape `<`, so a value containing `</script>` is unsafe
 * unless HTML-significant characters are encoded first. The replacements preserve JSON values.
 */
export function serializeJsonLd(value: unknown): string {
  const escapes: Record<string, string> = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
  };
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => escapes[character]);
}

/** Sitemap entries for every public route, each advertising its exact bilingual pair. */
export function sitePublicSitemap(): MetadataRoute.Sitemap {
  const homeLanguages = {
    ar: siteUrl("ar"),
    en: siteUrl("en"),
    "x-default": siteUrl("ar"),
  };
  const entries: MetadataRoute.Sitemap = [
    {
      url: siteUrl("ar"),
      changeFrequency: "monthly",
      priority: 1,
      alternates: { languages: homeLanguages },
    },
    {
      url: siteUrl("en"),
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: homeLanguages },
    },
  ];

  for (const page of PUBLIC_SITE_PAGE_KEYS) {
    const languages = {
      ar: siteUrl("ar", page),
      en: siteUrl("en", page),
      "x-default": siteUrl("ar", page),
    };
    entries.push(
      {
        url: siteUrl("ar", page),
        changeFrequency: "monthly",
        priority: 0.8,
        alternates: { languages },
      },
      {
        url: siteUrl("en", page),
        changeFrequency: "monthly",
        priority: 0.75,
        alternates: { languages },
      },
    );
  }
  return entries;
}
