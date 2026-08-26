import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/enquiry-actions", () => ({ submitEnquiry: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { SiteLanding } from "./SiteLanding";
import { SITE_CONTENT_DEFAULTS } from "@/lib/site-content";
import {
  PUBLIC_SITE_PAGES,
  PUBLIC_SITE_PAGE_KEYS,
  publicSitePagePath,
} from "@/lib/site-public-pages";

const source = readFileSync(resolve(__dirname, "./SiteLanding.tsx"), "utf8");
const siteCss = readFileSync(resolve(__dirname, "../../app/site.css"), "utf8");
const arabicLayout = readFileSync(
  resolve(__dirname, "../../app/(public-ar)/layout.tsx"),
  "utf8"
);
const englishLayout = readFileSync(
  resolve(__dirname, "../../app/(public-en)/layout.tsx"),
  "utf8"
);
const c = SITE_CONTENT_DEFAULTS;
const render = (lang: "ar" | "en") =>
  renderToStaticMarkup(<SiteLanding content={c} lang={lang} />);
// Long prose contains characters React escapes (e.g. `'` → `&#x27;`); compare on a plain prefix.
const opening = (text: string) => text.slice(0, 90);

describe("public site language routing", () => {
  it("server-renders the English copy for /en without any client interaction", () => {
    const html = render("en");

    expect(html).toContain(c.hero.headline.en);
    expect(html).toContain(c.hero.subhead.en);
    expect(html).toContain(opening(c.about.body.en));
    expect(html).toContain(c.specs.rows[0].value.en);
    expect(html).toContain("Request a Quote");
    // The Arabic translation of the same copy must NOT be what a crawler of /en receives.
    expect(html).not.toContain(c.hero.headline.ar);
    expect(html).not.toContain(opening(c.about.body.ar));
  });

  it("server-renders the Arabic copy for the canonical home", () => {
    const html = render("ar");

    expect(html).toContain(c.hero.headline.ar);
    expect(html).toContain(opening(c.about.body.ar));
    expect(html).not.toContain(c.hero.headline.en);
    expect(html).not.toContain(opening(c.about.body.en));
  });

  it("marks the section language and direction per route", () => {
    expect(render("ar")).toContain('class="site" dir="rtl" lang="ar"');
    expect(render("en")).toContain('class="site" dir="ltr" lang="en"');
    // Each public route owns a root document, so the initial server response is correct before
    // JavaScript runs and not merely corrected by a nested wrapper after hydration.
    expect(arabicLayout).toContain('<RootDocument lang="ar" dir="rtl">');
    expect(englishLayout).toContain('<RootDocument lang="en" dir="ltr">');
    expect(source).not.toContain("document.documentElement");
  });

  it("switches language through a crawlable link, not React state", () => {
    const ar = render("ar");
    const en = render("en");

    // HTML attribute names are case-insensitive; React serializes the JSX `hrefLang` spelling.
    expect(ar).toContain('href="/en"');
    expect(ar).toMatch(/hreflang="en"/i);
    expect(en).toContain('href="/"');
    expect(en).toMatch(/hreflang="ar"/i);
    // Both anchors must be real navigations a crawler can follow.
    expect(ar).toMatch(/<a[^>]*class="site__lang"[^>]*>English<\/a>/);
    expect(en).toMatch(/<a[^>]*class="site__lang"[^>]*>عربي<\/a>/);

    // No in-memory language toggle may come back: language is a prop derived from the URL.
    expect(source).not.toMatch(/useState<Lang>/);
    expect(source).not.toMatch(/setLang/);
    expect(source).toMatch(
      /export function SiteLanding\([\s\S]*content:\s*SiteContent;[\s\S]*lang:\s*Lang;/
    );
  });

  it("keeps every tracked action labelled with the rendered route's language", () => {
    // `lang` is now the route's language, so the analytics label follows the URL on both pages.
    const tracked = [
      ...source.matchAll(/trackPublicSiteAction\("([a-z_]+)",\s*([a-zA-Z]+)/g),
    ];
    expect(tracked.length).toBeGreaterThanOrEqual(6);
    for (const [, action, languageArg] of tracked) {
      expect(languageArg, action).toBe("lang");
    }
  });

  it("server-renders crawlable internal links to every focused page in the route language", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = render(lang);
      for (const page of PUBLIC_SITE_PAGE_KEYS) {
        expect(html).toContain(`href="${publicSitePagePath(lang, page)}"`);
      }
    }
  });

  it("fails closed on homepage certificate claims when no proof is published", () => {
    const withoutProofs = {
      ...c,
      certifications: { ...c.certifications, items: [] },
    };
    const html = renderToStaticMarkup(
      <SiteLanding content={withoutProofs} lang="en" />
    );

    expect(html).not.toContain(c.hero.subhead.en);
    expect(html).not.toContain(c.hero.badges[0].en);
    expect(html).not.toContain(c.brand.tagline.en);
    expect(html).not.toContain(PUBLIC_SITE_PAGES.chinaSupply.description.en);
    expect(html).not.toContain(PUBLIC_SITE_PAGES.certifications.description.en);
    expect(html).toContain("Contact the Farm for supply specifications");
    expect(html).toContain("No certificate is currently published");
    expect(html).toContain("Fresh Barhi dates from El-Sharkia");
  });

  it("suppresses unsafe certificate links and images on the homepage", () => {
    const hostile = {
      ...c,
      certifications: {
        ...c.certifications,
        items: c.certifications.items.map((item, index) =>
          index === 0
            ? {
                ...item,
                verifyUrl: "javascript:alert(1)",
                image: "https://tracker.example/pixel.png?visitor=1",
              }
            : item
        ),
      },
    };
    const html = renderToStaticMarkup(
      <SiteLanding content={hostile} lang="en" />
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain('href="#"');
    expect(html).toContain("Verification link unavailable");
    expect(html).toContain("site__cert-image-unavailable");
    expect(siteCss).toMatch(
      /\.site__cert-body h3,[\s\S]*?\.site__cert-host[\s\S]*?overflow-wrap:\s*anywhere;/
    );
  });
});
