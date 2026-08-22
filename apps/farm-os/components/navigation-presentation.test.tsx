import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MobileTabBar } from "./MobileTabBar";
import { ModuleSidebar } from "./ModuleSidebar";
import { primaryNavigationForRole, workspaceModulesForRole } from "@/lib/nav";

describe("consolidated navigation presentation", () => {
  it("renders the owner task spine and eight collapsed workspaces with Lucide icons", () => {
    const html = renderToStaticMarkup(
      <ModuleSidebar
        primaryItems={primaryNavigationForRole("owner")}
        workspaces={workspaceModulesForRole("owner")}
        activeNavId="dashboard"
        activePrimaryNavId="dashboard"
        activePrimaryIsExact
        onNavigate={() => {}}
      />,
    );

    expect(html).toContain("العمل اليومي");
    expect(html).toContain("مساحات العمل");
    expect(html).toContain("aria-current=\"page\"");
    expect(html.match(/aria-expanded=\"false\"/g)).toHaveLength(8);
    expect(html).toContain("lucide-house");
    expect(html).not.toMatch(/[🏠➕🖊📜📈💡🌴📦⚙️]/u);
  });

  it("renders four role-valid phone tabs and maps receipt work to inventory", () => {
    const html = renderToStaticMarkup(<MobileTabBar role="storekeeper" pathname="/m/receive" />);

    expect(html).toContain("repeat(4, minmax(0, 1fr))");
    expect(html).toMatch(/<a aria-current="location"[^>]+href="\/inventory\/dashboard">/);
    expect(html).not.toContain("href=\"/m\"");
    expect(html).not.toMatch(/[🏠➕📦📈]/u);
  });

  it("pins the RTL phone bar to both viewport edges", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf(".farm-bottom-nav {"), css.indexOf("@media (max-width: 39.99rem)"));
    expect(block).toContain("inset-inline: 0");
    expect(block).toContain("inline-size: 100%");
  });
});
