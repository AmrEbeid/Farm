import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("keeps identity, metadata, subtitle, and actions in the shared compact structure", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="ملف النخلة"
        subtitle="آخر تحديث اليوم"
        metadata={<span>نشطة</span>}
        actions={<button type="button">تعديل</button>}
      />,
    );

    expect(html).toContain('class="farm-page-header"');
    expect(html).toContain('class="farm-page-header__title"');
    expect(html).toContain('title="ملف النخلة"');
    expect(html).toContain('class="farm-page-header__subtitle"');
    expect(html).toContain('class="farm-page-header__actions"');
    expect(html).toContain("ملف النخلة");
    expect(html).toContain("آخر تحديث اليوم");
    expect(html).toContain("نشطة");
    expect(html).toContain("تعديل");
    expect(html).not.toContain("text-2xl");
  });

  it("does not reserve an empty action row", () => {
    const html = renderToStaticMarkup(<PageHeader title="المخزون" />);
    expect(html).not.toContain("farm-page-header__actions");
  });

  it("caps phone titles at two visual lines while leaving the full text in the document", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    expect(css).toMatch(
      /\.farm-page-header__title\s*\{[^}]*font-size:\s*1\.25rem;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 39\.99rem\)[\s\S]*?\.farm-page-header__title\s*\{[^}]*display: -webkit-box;[^}]*overflow: hidden;[^}]*-webkit-line-clamp: 2;[^}]*line-clamp: 2;/,
    );
  });

  it("scopes compact KPI styling to the authenticated app shell", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    expect(css).toContain(".fos-appshell .fos-kpi {");
    expect(css).toContain(".fos-appshell .fos-kpi__icon {");
    expect(css).toContain(".fos-appshell .fos-kpi__value {");
    expect(css).not.toMatch(/\n\.fos-kpi\s*\{/);
  });
});
