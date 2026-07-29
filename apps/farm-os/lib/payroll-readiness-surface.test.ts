import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "./auth";
import { APP_NAV, findActiveNavItem, visibleModulesForRole } from "./nav";
import { helpForPath } from "./page-help";
import {
  PAYROLL_READINESS_ITEMS,
  READINESS_EVIDENCE_AR,
  READINESS_NO_WRITE_AR,
  READINESS_OUT_OF_SCOPE_AR,
  READINESS_PURPOSE_AR,
  READINESS_SYNTHETIC_ONLY_AR,
  READINESS_UNSIGNED_AR,
  type ReadinessEvidence,
} from "./payroll-readiness";
import { PAYROLL_READINESS_DESCRIPTORS } from "./import/descriptors/payroll-readiness";

/**
 * Source-and-nav contract guard for «جاهزية الرواتب».
 *
 * The page is a preparation sheet for a PII-and-money-adjacent workflow, so three things must not
 * regress quietly: only owner/accountant can reach it, it reads nothing and claims nothing, and its
 * three embedded panels stay validation-only. tsc and eslint see none of that, so it is pinned here.
 */

const APP_ROOT = process.cwd();
const PAGE = join(APP_ROOT, "app", "(app)", "people", "payroll", "readiness", "page.tsx");

const ALL_ROLES: Role[] = [
  "owner",
  "farm_manager",
  "agri_engineer",
  "accountant",
  "supervisor",
  "storekeeper",
];
const ALLOWED: Role[] = ["owner", "accountant"];

const source = readFileSync(PAGE, "utf8");
const navIds = (role: Role) =>
  visibleModulesForRole(role).flatMap((appModule) => appModule.pages.map((page) => page.id));

describe("payroll readiness nav entry", () => {
  it("exists once, under the people module, pointing at the real route", () => {
    const entries = APP_NAV.filter((item) => item.id === "payroll-readiness");
    expect(entries).toHaveLength(1);
    expect(entries[0].href).toBe("/people/payroll/readiness");
    expect(existsSync(PAGE)).toBe(true);
  });

  it("is visible to owner and accountant, and to nobody else", () => {
    for (const role of ALL_ROLES) {
      expect(navIds(role).includes("payroll-readiness"), role).toBe(ALLOWED.includes(role));
    }
  });

  it("owns its own route without stealing (or being stolen by) the run report", () => {
    expect(findActiveNavItem("/people/payroll/readiness")?.id).toBe("payroll-readiness");
    expect(findActiveNavItem("/people/payroll")?.id).toBe("payroll");
    expect(findActiveNavItem(`/people/payroll/${"a".repeat(8)}`)?.id).toBe("payroll");
    expect(findActiveNavItem("/people/payroll/compensation")?.id).toBe("payroll-compensation");
  });

  it("has its own page help, not the closed-run report's", () => {
    const help = helpForPath("/people/payroll/readiness", "payroll-readiness");
    expect(help?.title).toBe("جاهزية الرواتب");
    expect(help?.avoid).toContain("لا تكتب شيئًا");
    expect(help?.avoid).toContain("المرحلة M");
    // The run report keeps its own help at the same depth.
    expect(helpForPath("/people/payroll/run-1", "payroll")?.title).toBe("تقرير إقفال الرواتب");
  });
});

describe("payroll readiness page — access and reads", () => {
  it("requires owner or accountant, and nothing else", () => {
    expect(source).toContain('requireRole(["owner", "accountant"])');
    for (const role of ALL_ROLES.filter((r) => !ALLOWED.includes(r))) {
      expect(source, role).not.toContain(`"${role}"`);
    }
  });

  it("queries nothing at all — no wage, labor or contact read exists to gate", () => {
    for (const forbidden of [
      "createClient",
      "supabase",
      ".from(",
      "people_compensation",
      "labor_logs",
      "payroll_run",
      "phone",
      "email",
    ]) {
      expect(source, `page must not reference "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("offers attendance only to the owner (an accountant would be redirected)", () => {
    expect(source).toContain('m.role === "owner"');
    expect(source).toContain("canOpenAttendance && ");
  });

  it("links the compensation editor and the payroll close unconditionally", () => {
    expect(source).toContain('href="/people/payroll/compensation"');
    expect(source).toContain('href="/people/payroll"');
    expect(source).toContain("/people/attendance");
  });

  it("points at the pilot readiness and payroll specs by name", () => {
    expect(source).toContain("docs/PILOT-READINESS.md");
    expect(source).toContain("docs/SPEC-0006-people-labor-payroll.md");
  });
});

describe("payroll readiness page — compact, printable, accessible", () => {
  it("uses the compact header/spacing convention and no oversized heading", () => {
    expect(source).toContain('className="flex flex-col gap-4 p-4"');
    expect(source).toContain('<h1 className="text-xl font-bold">');
    for (const oversized of ["text-2xl", "text-3xl", "text-4xl"]) {
      expect(source, oversized).not.toContain(oversized);
    }
  });

  it("renders no hero and no nested cards", () => {
    expect(source).not.toContain("<Card");
    expect(source).not.toContain("KpiCard");
    expect(source).not.toContain("hero");
  });

  it("is printable: a print button, and the interactive panels excluded from print", () => {
    expect(source).toContain("PrintButton");
    expect(source).toContain('className="no-print flex flex-col gap-2"');
  });

  it("gives the checklist table a caption and real column headers", () => {
    expect(source).toContain("<caption");
    expect(source).toContain('scope="col"');
    expect(source).toContain("التوقيع والتاريخ");
  });

  it("labels every section heading with aria-labelledby", () => {
    expect(source).toContain("aria-labelledby=");
    expect(source).toContain('id="readiness-checklist-heading"');
  });
});

describe("payroll readiness page — the three panels", () => {
  it("embeds every registered readiness descriptor, each validation-only", () => {
    // One JSX element mapped over the registered set — so a fourth descriptor appears here
    // automatically, and a removed one cannot leave a dangling panel behind.
    expect(source.match(/<ImportPanel[^>]*validationOnly/g) ?? []).toHaveLength(1);
    expect(source).toContain("PAYROLL_READINESS_DESCRIPTORS.map(");
    expect(source).toContain("validationOnly />");
    expect(PAYROLL_READINESS_DESCRIPTORS).toHaveLength(3);
  });

  it("never mounts a commit-capable panel here", () => {
    expect(source).not.toMatch(/<ImportPanel(?![^>]*validationOnly)/);
  });
});

describe("the checklist itself tells the truth", () => {
  it("has unique ids and covers every gate the pilot needs", () => {
    const ids = PAYROLL_READINESS_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
      "privacy-stage-m",
      "source-approval",
      "template-dry-runs",
      "compensation-setup",
      "attendance-entry",
      "accountant-close",
      "frozen-report-review",
      "exceptions-resolved",
      "dual-signoff",
      "payment-journal-scope",
    ]) {
      expect(ids, required).toContain(required);
    }
  });

  it("separates automated evidence from human gates, and is mostly human", () => {
    const withEvidence = (kind: ReadinessEvidence) =>
      PAYROLL_READINESS_ITEMS.filter((item) => item.evidence === kind);
    const automated = withEvidence("automated");
    const human = withEvidence("human");
    expect(automated.map((i) => i.id)).toEqual(["template-dry-runs"]);
    expect(human.length).toBe(PAYROLL_READINESS_ITEMS.length - automated.length);
    expect(Object.keys(READINESS_EVIDENCE_AR).sort()).toEqual(["automated", "human"]);
  });

  it("never claims completion, a percentage, or an approval", () => {
    const text = [
      READINESS_PURPOSE_AR,
      READINESS_NO_WRITE_AR,
      READINESS_SYNTHETIC_ONLY_AR,
      READINESS_OUT_OF_SCOPE_AR,
      READINESS_UNSIGNED_AR,
      ...PAYROLL_READINESS_ITEMS.flatMap((i) => [i.titleAr, i.detailAr]),
    ].join("\n");
    for (const claim of ["100%", "١٠٠٪", "١٠٠٫", "مكتملة الجاهزية", "جاهز تمامًا", "معتمد بالكامل"]) {
      expect(text, claim).not.toContain(claim);
    }
    expect(READINESS_PURPOSE_AR).toContain("لا تحسب نسبة إنجاز");
    expect(READINESS_PURPOSE_AR).toContain("لا تمنح اعتمادًا");
    expect(READINESS_UNSIGNED_AR).toBe("لم تُغلق بعد");
    // No progress/percentage rendering on the page either.
    expect(source).not.toContain("Progress");
    expect(source).not.toContain("%");
  });

  it("states the no-write, synthetic-only and out-of-scope boundaries, and the page shows them", () => {
    expect(READINESS_NO_WRITE_AR).toContain("للتحقق فقط");
    expect(READINESS_NO_WRITE_AR).toContain("لا يوجد لها زر استيراد");
    expect(READINESS_SYNTHETIC_ONLY_AR).toContain("المرحلة M");
    expect(READINESS_OUT_OF_SCOPE_AR).toContain("قيد محاسبي");
    expect(READINESS_OUT_OF_SCOPE_AR).toContain("صرف");
    for (const constant of [
      "READINESS_NO_WRITE_AR",
      "READINESS_SYNTHETIC_ONLY_AR",
      "READINESS_OUT_OF_SCOPE_AR",
      "READINESS_UNSIGNED_AR",
      "READINESS_PURPOSE_AR",
    ]) {
      expect(source, constant).toContain(constant);
    }
  });

  it("names no person, rate or farm anywhere in the checklist copy", () => {
    const text = PAYROLL_READINESS_ITEMS.flatMap((i) => [i.titleAr, i.detailAr]).join("\n");
    expect(text).not.toMatch(/\d/); // no figures at all — nothing to mistake for a real number
    expect(text).not.toContain("ج.م");
  });

  it("gives every item a title, a detail and an evidence kind", () => {
    for (const item of PAYROLL_READINESS_ITEMS) {
      expect(item.titleAr.trim().length, item.id).toBeGreaterThan(0);
      expect(item.detailAr.trim().length, item.id).toBeGreaterThan(0);
      expect(["automated", "human"], item.id).toContain(item.evidence);
    }
  });
});
