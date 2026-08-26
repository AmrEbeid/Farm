// Localized SEO signals for the PUBLIC marketing site — shared by the Arabic canonical home (`/`),
// the crawlable English page (`/en`), robots.ts and sitemap.ts so the four can never drift apart.
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

export const SITE_ORIGIN = "https://ebeidfarm.business";

/** The only two publicly indexable routes. Arabic keeps the canonical home at `/`. */
export const SITE_PATH: Record<Lang, string> = { ar: "/", en: "/en" };

/** Text direction per language — applied to the site section wrapper. */
export const SITE_DIR: Record<Lang, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };

const OG_LOCALE: Record<Lang, string> = { ar: "ar_EG", en: "en_US" };

export function otherLang(lang: Lang): Lang {
  return lang === "ar" ? "en" : "ar";
}

/** Absolute URL of a public route (for the sitemap and JSON-LD `@id`/`url`). */
export function siteUrl(lang: Lang): string {
  return new URL(SITE_PATH[lang], SITE_ORIGIN).href;
}

/**
 * canonical + hreflang. Arabic is `x-default` because `/` is the canonical home for
 * unmatched/unknown languages. Paths stay relative — the root layout's `metadataBase`
 * resolves them to absolute URLs.
 */
export function siteAlternates(lang: Lang): NonNullable<Metadata["alternates"]> {
  return {
    canonical: SITE_PATH[lang],
    languages: {
      ar: SITE_PATH.ar,
      en: SITE_PATH.en,
      "x-default": SITE_PATH.ar,
    },
  };
}

/**
 * <head> metadata for a public route, in that route's language. Built from the typed defaults
 * (not the DB) so producing metadata costs no extra read on the ISR path; the same Owner-approved
 * copy the page renders.
 */
export function siteMetadata(
  lang: Lang,
  content: SiteContent = SITE_CONTENT_DEFAULTS,
): Metadata {
  const { brand, hero } = content;
  return {
    // `absolute` so the root layout's "· نظام تشغيل المزارع" template does NOT append the
    // internal app name to the public marketing pages' <title>.
    title: { absolute: `${brand.name[lang]} · ${hero.headline[lang]}` },
    description: hero.subhead[lang],
    alternates: siteAlternates(lang),
    openGraph: {
      title: `${brand.name[lang]} — ${hero.headline[lang]}`,
      description: hero.subhead[lang],
      url: SITE_PATH[lang],
      siteName: brand.name[lang],
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
  const organizationId = `${SITE_ORIGIN}/#organization`;
  const websiteId = `${SITE_ORIGIN}/#website`;
  const primaryPhone = (content.contact.phones[0] ?? "").replace(/[^0-9+]/g, "");
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
        description: content.hero.subhead[lang],
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
        "@id": `${siteUrl(lang)}#webpage`,
        url: siteUrl(lang),
        name: content.hero.headline[lang],
        description: content.hero.subhead[lang],
        inLanguage: lang,
        isPartOf: { "@id": websiteId },
        about: { "@id": organizationId },
      },
    ],
  };
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

/** Sitemap entries for the two public routes, each advertising the full hreflang set. */
export function sitePublicSitemap(): MetadataRoute.Sitemap {
  const languages = {
    ar: siteUrl("ar"),
    en: siteUrl("en"),
    "x-default": siteUrl("ar"),
  };
  return [
    { url: siteUrl("ar"), changeFrequency: "monthly", priority: 1, alternates: { languages } },
    { url: siteUrl("en"), changeFrequency: "monthly", priority: 0.9, alternates: { languages } },
  ];
}
