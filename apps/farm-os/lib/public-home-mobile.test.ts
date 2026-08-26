import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../app/site.css"), "utf8");
const landing = readFileSync(
  resolve(__dirname, "../components/site/SiteLanding.tsx"),
  "utf8"
);

describe("public homepage mobile layout", () => {
  it("collapses desktop navigation into a compact phone header", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 719px)"));
    expect(mobile).toMatch(/\.site__nav\s*{\s*display:\s*none;/);
    expect(mobile).toContain(".site__mobile-menu {");
    expect(mobile).toContain("min-height: 56px");
    expect(mobile).toContain("flex-wrap: nowrap");
    expect(landing).toContain('<details className="site__mobile-menu">');
    expect(landing).toContain("<Menu width={20} height={20}");
  });

  it("uses a compact phone hero and statistics strip", () => {
    expect(css).toMatch(
      /\.site__hero-inner\s*{\s*padding:\s*2\.25rem 1rem 3\.25rem;/
    );
    expect(css).toMatch(
      /\.site__title\s*{[\s\S]*?max-width:\s*none;[\s\S]*?font-size:\s*1\.75rem;/
    );
    expect(css).toMatch(
      /\.site__stats\s*{[\s\S]*?margin-block-start:\s*-1\.5rem;/
    );
    expect(
      css.indexOf(".site__stat {\n    border-radius: 8px;")
    ).toBeGreaterThan(css.indexOf(".site__stat {\n  background: #fff;"));
  });

  it("keeps the honeypot clipped without a large physical offset", () => {
    const honeypot = css.slice(
      css.indexOf(".site__enquiry .site__hp {"),
      css.indexOf("}", css.indexOf(".site__enquiry .site__hp {"))
    );
    expect(honeypot).toContain("clip-path: inset(50%)");
    expect(honeypot).not.toMatch(/left:\s*-\d/);
    expect(honeypot).not.toMatch(/right:\s*-\d/);
  });
});
