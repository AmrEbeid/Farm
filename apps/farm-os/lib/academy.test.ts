import { describe, it, expect } from "vitest";
import { authoritativeness, disclaimer, type AcademyContent } from "./academy";

const NOW = "2026-07-01";

const base = (over: Partial<AcademyContent>): AcademyContent => ({
  id: "c1",
  title: "تسميد البرحي",
  hasChemical: false,
  ...over,
});

describe("academy authoritativeness gate (non-negotiable #4)", () => {
  it("unsigned content is advisory (the default — never authoritative)", () => {
    expect(authoritativeness(base({}), NOW)).toBe("advisory");
    expect(authoritativeness(base({ signOff: null }), NOW)).toBe("advisory");
  });

  it("a blank/invalid sign-off is advisory", () => {
    expect(authoritativeness(base({ signOff: { agronomistName: "  ", signedAt: NOW } }), NOW)).toBe("advisory");
    expect(authoritativeness(base({ signOff: { agronomistName: "م. أحمد", signedAt: "not-a-date" } }), NOW)).toBe("advisory");
  });

  it("non-chemical content with a valid agronomist sign-off is authoritative", () => {
    expect(
      authoritativeness(base({ signOff: { agronomistName: "م. أحمد", signedAt: "2026-06-01" } }), NOW),
    ).toBe("authoritative");
  });

  it("CHEMICAL content needs a current Egyptian pesticide registration — missing ⇒ advisory", () => {
    const c = base({ hasChemical: true, signOff: { agronomistName: "م. أحمد", signedAt: "2026-06-01" } });
    expect(authoritativeness(c, NOW)).toBe("advisory"); // signed but no registration
  });

  it("chemical content with an EXPIRED registration ⇒ advisory", () => {
    const c = base({
      hasChemical: true,
      signOff: { agronomistName: "م. أحمد", signedAt: "2026-06-01", pesticideRegValidUntil: "2026-05-01" },
    });
    expect(authoritativeness(c, NOW)).toBe("advisory"); // expired before NOW
  });

  it("chemical content with a current registration ⇒ authoritative", () => {
    const c = base({
      hasChemical: true,
      signOff: { agronomistName: "م. أحمد", signedAt: "2026-06-01", pesticideRegValidUntil: "2027-01-01" },
    });
    expect(authoritativeness(c, NOW)).toBe("authoritative");
  });
});

describe("mandatory disclaimer", () => {
  it("advisory content ALWAYS carries the review-with-agronomist banner", () => {
    const d = disclaimer(base({}), NOW);
    expect(d.authoritative).toBe(false);
    expect(d.ar).toContain("راجِع مهندسك الزراعي");
    expect(d.ar).toContain("غير معتمد");
  });

  it("authoritative content names the approver + date", () => {
    const d = disclaimer(base({ signOff: { agronomistName: "م. أحمد", signedAt: "2026-06-01" } }), NOW);
    expect(d.authoritative).toBe(true);
    expect(d.ar).toContain("م. أحمد");
    expect(d.ar).toContain("2026-06-01");
  });
});
