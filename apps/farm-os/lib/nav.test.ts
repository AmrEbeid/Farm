import { describe, it, expect } from "vitest";
import { APP_NAV } from "./nav";

const ROLES = ["owner", "farm_manager", "agri_engineer", "accountant", "supervisor", "storekeeper"];

describe("APP_NAV", () => {
  it("has unique ids and non-empty labels", () => {
    const ids = APP_NAV.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of APP_NAV) expect(item.label.trim().length).toBeGreaterThan(0);
  });

  it("every href is a safe relative path (no external/script schemes)", () => {
    for (const item of APP_NAV) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href).not.toMatch(/^[a-z]+:/i); // no javascript:/http:/etc.
    }
  });

  it("role-gated items list only known roles", () => {
    for (const item of APP_NAV) {
      if (!item.roles) continue;
      expect(item.roles.length).toBeGreaterThan(0);
      for (const r of item.roles) expect(ROLES).toContain(r);
    }
  });
});
