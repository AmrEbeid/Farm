import { describe, it, expect } from "vitest";
import { APP_NAV } from "./nav";
import { PAGE_HELP, helpFor } from "./page-help";

describe("page help completeness (SPEC-0014 A1 / Documentation Health Score)", () => {
  it("has a help entry for every primary nav page (drift guard)", () => {
    for (const item of APP_NAV) {
      expect(PAGE_HELP[item.id], `missing page help for nav id "${item.id}"`).toBeDefined();
    }
  });

  it("every help entry answers all five questions (non-empty)", () => {
    for (const [id, h] of Object.entries(PAGE_HELP)) {
      for (const field of ["title", "what", "why", "when", "how", "avoid"] as const) {
        expect(h[field].trim().length, `${id}.${field} is empty`).toBeGreaterThan(0);
      }
      expect(Array.isArray(h.related), `${id}.related must be an array`).toBe(true);
    }
  });

  it("related ids reference real nav pages", () => {
    const navIds = new Set(APP_NAV.map((i) => i.id));
    for (const [id, h] of Object.entries(PAGE_HELP)) {
      for (const rel of h.related) {
        expect(navIds.has(rel), `${id}.related "${rel}" is not a nav id`).toBe(true);
      }
    }
  });

  it("helpFor returns an entry for a known id and null otherwise", () => {
    expect(helpFor("inventory")?.title.length).toBeGreaterThan(0);
    expect(helpFor("nonexistent")).toBeNull();
  });
});
