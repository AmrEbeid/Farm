import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_CONTENT_DEFAULTS } from "./site-content";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260827120000 correct ebeid company name.sql"
  ),
  "utf8"
);

describe("public company name", () => {
  it("uses the Owner-confirmed Ebeid spelling in English public content", () => {
    expect(SITE_CONTENT_DEFAULTS.brand.name.en).toBe("Ebeid Farm");
    expect(SITE_CONTENT_DEFAULTS.brand.registeredName.en).toBe(
      "Ebeid Company for Dates"
    );
    expect(SITE_CONTENT_DEFAULTS.certifications.items[1]?.detail.en).toContain(
      "Ebeid Company for Dates"
    );

    const publicContent = JSON.stringify(SITE_CONTENT_DEFAULTS);
    expect(publicContent).not.toMatch(/\bOb[ae]id\b/i);
  });

  it("patches only the two saved English name paths and is safe to replay", () => {
    expect(migration).toContain("'{brand,registeredName,en}'");
    expect(migration).toContain("'{certifications,items,1,detail,en}'");
    expect(migration).toContain("Ebeid Company for Dates");
    expect(migration).toContain("for update");
    expect(migration).toContain("v_registered_name is null or");
    expect(migration).toContain("v_gacc_detail is null or");
    expect(migration).toContain("and v_gacc_detail =");
    expect(migration).toContain("return;");
    expect(migration).toContain("Safety stop: unexpected saved English");
  });
});
