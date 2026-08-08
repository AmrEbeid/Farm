import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_CONTENT_DEFAULTS } from "./site-content";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260807220000_owner_public_site_comments.sql",
  ),
  "utf8",
);
const landing = readFileSync(
  join(process.cwd(), "components/site/SiteLanding.tsx"),
  "utf8",
);

describe("Owner public-site comments", () => {
  it("keeps the default public content aligned with every requested edit", () => {
    expect(SITE_CONTENT_DEFAULTS.stats.map(({ value }) => value)).toEqual([120, 5000, 202, 7]);
    expect(SITE_CONTENT_DEFAULTS.about.heading.ar).toBe("من نحن");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("تأسست المزرعة منذ 10 سنوات");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("شركة ساباد");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("120 فداناً");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("5,000 نخلة بارحي");
    expect(SITE_CONTENT_DEFAULTS.about.body.ar).toContain("7 قطاعات");
    expect(SITE_CONTENT_DEFAULTS.contact.person.ar).toBe("مزرعة عبيد للتمور");
    expect(SITE_CONTENT_DEFAULTS.contact.email).toBe("ebeidfarm@gmail.com");
    expect(SITE_CONTENT_DEFAULTS.specs.rows[5]?.value.ar).toContain("دول شرق آسيا");
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
});
