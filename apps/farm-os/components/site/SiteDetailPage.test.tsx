import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { SiteDetailPage } from "@/components/site/SiteDetailPage";
import { SITE_CONTENT_DEFAULTS } from "@/lib/site-content";
import {
  PUBLIC_SITE_PAGES,
  PUBLIC_SITE_PAGE_KEYS,
  publicSitePageFaqs,
  publicSitePagePath,
} from "@/lib/site-public-pages";

describe("focused public search pages", () => {
  it("renders every page in Arabic and English with one focused H1 and reciprocal language link", () => {
    for (const page of PUBLIC_SITE_PAGE_KEYS) {
      for (const lang of ["ar", "en"] as const) {
        const html = renderToStaticMarkup(
          <SiteDetailPage
            content={SITE_CONTENT_DEFAULTS}
            lang={lang}
            page={page}
          />
        );
        const opposite = lang === "ar" ? "en" : "ar";

        expect(html.match(/<h1/g)).toHaveLength(1);
        expect(html).toContain(PUBLIC_SITE_PAGES[page].heading[lang]);
        expect(html).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
        expect(html).toContain(`lang="${lang}"`);
        expect(html).toContain(`href="${publicSitePagePath(opposite, page)}"`);
        expect(html).toContain(lang === "ar" ? "أسئلة المشترين" : "Buyer FAQs");
        for (const faq of publicSitePageFaqs(page)) {
          expect(html).toContain(faq.question[lang]);
          expect(html).toContain(faq.answer[lang]);
        }
        expect(html).not.toContain(PUBLIC_SITE_PAGES[page].heading[opposite]);
      }
    }
  });

  it("links each page to every other focused route in the same language", () => {
    const html = renderToStaticMarkup(
      <SiteDetailPage content={SITE_CONTENT_DEFAULTS} lang="en" page="barhi" />
    );
    for (const page of PUBLIC_SITE_PAGE_KEYS.filter((key) => key !== "barhi")) {
      expect(html).toContain(`href="${publicSitePagePath("en", page)}"`);
    }
  });

  it("does not render an unsafe owner-managed certificate link", () => {
    const hostile = {
      ...SITE_CONTENT_DEFAULTS,
      certifications: {
        ...SITE_CONTENT_DEFAULTS.certifications,
        items: SITE_CONTENT_DEFAULTS.certifications.items.map((item, index) =>
          index === 0 ? { ...item, verifyUrl: "javascript:alert(1)" } : item
        ),
      },
    };
    const html = renderToStaticMarkup(
      <SiteDetailPage content={hostile} lang="en" page="certifications" />
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="#"');
    expect(html).toContain("Verification link unavailable");
  });

  it("does not request an owner-managed certificate image outside approved storage", () => {
    const hostile = {
      ...SITE_CONTENT_DEFAULTS,
      certifications: {
        ...SITE_CONTENT_DEFAULTS.certifications,
        items: SITE_CONTENT_DEFAULTS.certifications.items.map((item, index) =>
          index === 0
            ? { ...item, image: "https://tracker.example/pixel.png?visitor=1" }
            : item
        ),
      },
    };
    const html = renderToStaticMarkup(
      <SiteDetailPage content={hostile} lang="en" page="certifications" />
    );

    expect(html).not.toContain("tracker.example");
    expect(html).toContain("site-detail__cert-image-unavailable");
  });

  it("does not republish disputed palm counts or areas on the canonical Farm-facts page", () => {
    const html = renderToStaticMarkup(
      <SiteDetailPage
        content={SITE_CONTENT_DEFAULTS}
        lang="en"
        page="farmFacts"
      />
    );

    expect(html).not.toContain(SITE_CONTENT_DEFAULTS.about.body.en);
    for (const stat of SITE_CONTENT_DEFAULTS.stats) {
      expect(html).not.toContain(stat.label.en);
    }
    expect(html).toContain(
      "disputed palm counts and areas are not republished here"
    );
  });

  it("fails closed instead of repeating certification claims when no proof is published", () => {
    const withoutProofs = {
      ...SITE_CONTENT_DEFAULTS,
      certifications: { ...SITE_CONTENT_DEFAULTS.certifications, items: [] },
    };
    for (const page of ["chinaSupply", "certifications"] as const) {
      const html = renderToStaticMarkup(
        <SiteDetailPage content={withoutProofs} lang="en" page={page} />
      );
      expect(html).not.toContain(SITE_CONTENT_DEFAULTS.certifications.intro.en);
      expect(html).not.toContain(SITE_CONTENT_DEFAULTS.brand.tagline.en);
      expect(html).toContain("No certificate is currently published");
      expect(html).not.toContain("Eligible for Supply to China");
      if (page === "chinaSupply") {
        for (const row of SITE_CONTENT_DEFAULTS.specs.rows) {
          expect(html).not.toContain(row.value.en);
        }
      }
    }
  });

  it("labels focused product and commercial specifications as published, enquiry-only data", () => {
    for (const page of ["barhi", "exportSupply", "wholesale"] as const) {
      const html = renderToStaticMarkup(
        <SiteDetailPage content={SITE_CONTENT_DEFAULTS} lang="en" page={page} />
      );
      expect(html).toContain(
        "They are not a quote or confirmation of available quantity"
      );
      expect(html).not.toContain("202 tons");
      expect(html).not.toContain("Certified Destinations");
      expect(html).toContain("Packaging");
      expect(html).toContain("To buyer spec (5 / 10 kg cartons");
    }
    const exportHtml = renderToStaticMarkup(
      <SiteDetailPage
        content={SITE_CONTENT_DEFAULTS}
        lang="en"
        page="exportSupply"
      />
    );
    expect(exportHtml).not.toContain(
      SITE_CONTENT_DEFAULTS.whyPartner.bullets[0].text.en
    );
  });

  it("labels the owner-managed season as published rather than live availability", () => {
    for (const page of ["barhi", "exportSupply", "wholesale"] as const) {
      const html = renderToStaticMarkup(
        <SiteDetailPage content={SITE_CONTENT_DEFAULTS} lang="en" page={page} />
      );
      expect(html).toContain("Last published season");
      expect(html).toContain(SITE_CONTENT_DEFAULTS.brand.season.en);
      expect(html).toContain("This is not a live availability status");
    }
  });

  it("gives export-company and wholesale buyers distinct next-step guidance", () => {
    const exportHtml = renderToStaticMarkup(
      <SiteDetailPage
        content={SITE_CONTENT_DEFAULTS}
        lang="en"
        page="exportSupply"
      />
    );
    const wholesaleHtml = renderToStaticMarkup(
      <SiteDetailPage
        content={SITE_CONTENT_DEFAULTS}
        lang="en"
        page="wholesale"
      />
    );

    expect(exportHtml).toContain("Before supplying an export company");
    expect(exportHtml).toContain("export responsibilities are agreed");
    expect(exportHtml).not.toContain("Prepare your quote request");
    expect(wholesaleHtml).toContain("Prepare your quote request");
    expect(wholesaleHtml).toContain("Delivery country and city");
    expect(wholesaleHtml).not.toContain("Before supplying an export company");
  });
});
