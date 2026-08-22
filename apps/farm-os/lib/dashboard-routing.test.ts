import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { primaryNavIdForPath } from "./nav";

function appSource(path: string): string {
  return readFileSync(join(process.cwd(), "app", "(app)", path), "utf8");
}

describe("role home routing", () => {
  it("routes the accountant to the bounded finance home and keeps owner home owner-only", () => {
    const router = appSource("dashboard/page.tsx");
    const ownerHome = appSource("dashboard/owner/page.tsx");

    expect(router).toContain('if (m.role === "owner") redirect("/dashboard/owner")');
    expect(router).toContain('if (m.role === "accountant") redirect("/finance/dashboard")');
    expect(ownerHome).toContain('requireRole(["owner"])');
    expect(ownerHome).not.toContain('requireRole(["owner", "accountant"])');
  });

  it("keeps the accountant Home destination active on the finance landing route", () => {
    expect(primaryNavIdForPath("accountant", "/finance/dashboard")).toBe("dashboard");
    expect(primaryNavIdForPath("owner", "/finance/dashboard")).toBeNull();
  });
});
