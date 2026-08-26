import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SITE_CONTENT_DEFAULTS,
  SITE_CONTENT_PUBLIC_READ_FALLBACK,
  mergeSiteContent,
  normalizeSiteMapUrl,
} from "./site-content";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260807220000_owner_public_site_comments.sql"
  ),
  "utf8"
);
const landing = readFileSync(
  join(process.cwd(), "components/site/SiteLanding.tsx"),
  "utf8"
);

describe("Owner public-site comments", () => {
  it("keeps the default public content aligned with every requested edit", () => {
    expect(SITE_CONTENT_DEFAULTS.stats.map(({ value }) => value)).toEqual([
      120, 5000, 202, 7,
    ]);
    expect(SITE_CONTENT_DEFAULTS.about.heading.ar).toBe("من نحن");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain(
      "تأسست المزرعة منذ 10 سنوات"
    );
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("شركة ساباد");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("120 فداناً");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("5,000 نخلة بارحي");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("7 قطاعات");
    expect(SITE_CONTENT_DEFAULTS.contact.person.ar).toBe("مزرعة عبيد للتمور");
    expect(SITE_CONTENT_DEFAULTS.contact.email).toBe("ebeidfarm@gmail.com");
    expect(SITE_CONTENT_DEFAULTS.contact.mapUrl).toBe(
      "https://maps.app.goo.gl/G9XhCj1xLHWW3zgu9"
    );
    expect(SITE_CONTENT_DEFAULTS.specs.rows[5]?.value.ar).toContain(
      "دول شرق آسيا"
    );
  });

  it("adds the map URL to site content saved before that field existed", () => {
    const legacyContact = { ...SITE_CONTENT_DEFAULTS.contact };
    delete (legacyContact as Partial<typeof legacyContact>).mapUrl;

    expect(mergeSiteContent({ contact: legacyContact }).contact.mapUrl).toBe(
      SITE_CONTENT_DEFAULTS.contact.mapUrl
    );
  });

  it("preserves an explicitly stored map URL instead of replacing it with the default", () => {
    const storedMapUrl = "https://maps.example.test/persisted-farm-location";
    expect(
      mergeSiteContent({ contact: { mapUrl: storedMapUrl } }).contact.mapUrl
    ).toBe(storedMapUrl);
  });

  it("accepts only empty or absolute credential-free HTTPS map links", () => {
    expect(normalizeSiteMapUrl("  ")).toBe("");
    expect(normalizeSiteMapUrl(SITE_CONTENT_DEFAULTS.contact.mapUrl)).toBe(
      SITE_CONTENT_DEFAULTS.contact.mapUrl
    );
    for (const invalid of [
      "http://maps.example.test/farm",
      "mailto:farm@example.test",
      "tel:+201000000000",
      "#contact",
      "/farm-location",
      "//maps.example.test/farm",
      "javascript:alert(1)",
      "https://user:password@maps.example.test/farm",
      `https://maps.example.test/${"x".repeat(2048)}`,
      `https://maps.example.test/${"م".repeat(1000)}`,
    ]) {
      expect(normalizeSiteMapUrl(invalid)).toBeNull();
    }
  });

  it("patches the existing editable site row with the same owner copy", () => {
    for (const expected of [
      "'{stats,0,value}'",
      "'{stats,1,value}'",
      "'{stats,3,value}'",
      "'{about,body,ar}'",
      "مزرعة عبيد للتمور",
      "ebeidfarm@gmail.com",
      "دول شرق آسيا",
    ]) {
      expect(migration).toContain(expected);
    }
    expect(migration).toContain("for update");
    expect(migration).toContain("is distinct from 'Certified Destinations'");
    expect(migration).toContain("Safety stop: public-site content shape");
  });

  it("shows the primary phone once as WhatsApp and only the remaining phones as calls", () => {
    expect(landing).toContain("waLink(primaryPhone)");
    expect(landing).toContain("c.contact.phones.slice(1).map");
    expect(landing).not.toContain("c.contact.phones.map((p)");
  });

  it("fails closed on mutable public claims while keeping a minimal identity page available", () => {
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.certifications.items).toEqual([]);
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.stats).toEqual([]);
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.blocks.rows).toEqual([]);
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.specs.rows).toEqual([]);
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.whyPartner.bullets).toEqual([]);
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.hero.badges).toEqual([]);
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.hero.subhead.en).toContain(
      "temporarily unavailable"
    );
    expect(SITE_CONTENT_PUBLIC_READ_FALLBACK.hero.subhead.en).not.toContain(
      "Certified"
    );
    expect(landing).toContain(
      "const hasCertifications = c.certifications.items.length > 0"
    );
    expect(landing).toContain("{hasCertifications && (");
  });
});
