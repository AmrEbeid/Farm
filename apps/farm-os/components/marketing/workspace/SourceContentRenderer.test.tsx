import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SourceContentRenderer, hasUnsafeControl, sourceReferenceId } from "./SourceContentRenderer";
import { MARKETING_WORKSPACE_CONTENT } from "@/lib/marketing/workspace/content.generated";
import { MARKETING_SOURCE_ORACLE } from "@/lib/marketing/workspace/source-oracle.generated";
import { MARKETING_SOURCE_TAB_ORDER } from "@/lib/marketing/fidelity-manifest";

/**
 * SPEC-0032 — proves the REAL renderer `WorkspaceArea.tsx` calls (this exact file, unmodified —
 * not a re-implementation) actually renders the generated source content: real HTML is produced via
 * `react-dom/server`, and exact heading/table/control DOM ids are extracted from that HTML and
 * checked for presence + uniqueness, area by area. This is the fix for the prior gap where only a
 * detached generated-file count was asserted and nothing was ever rendered.
 *
 * Full-tree `WorkspaceArea` rendering isn't attempted here: its DB-backed panels are "use client"
 * components that call `useRouter()`/`useToast()`, which throw outside a mounted Next app router /
 * `<ToastProvider>` — reproducing that harness would need `jsdom` + `@testing-library/react`, new
 * dev dependencies this change does not add. `sourceContentWiring.test.ts` instead proves by static
 * source inspection that `WorkspaceArea.tsx` actually invokes this component for every area.
 */

function idsIn(html: string): string[] {
  return [...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
}

function renderArea(area: (typeof MARKETING_WORKSPACE_CONTENT)[number]): string {
  return renderToStaticMarkup(<SourceContentRenderer area={area} orgId="org-test" canWrite values={{}} />);
}

describe("SourceContentRenderer — renders the real generated content for all 25 areas", () => {
  it("covers exactly the 25 source areas (same set as the nav tab order; document order for the sections may legitimately differ from nav-button order)", () => {
    expect(new Set(MARKETING_WORKSPACE_CONTENT.map((a) => a.id))).toEqual(new Set(MARKETING_SOURCE_TAB_ORDER));
    expect(MARKETING_WORKSPACE_CONTENT).toHaveLength(25);
  });

  it.each(MARKETING_WORKSPACE_CONTENT.map((a) => a.id))("area '%s' renders unique DOM ids for every heading/table/control id it declares", (areaId) => {
    const area = MARKETING_WORKSPACE_CONTENT.find((a) => a.id === areaId)!;
    const html = renderArea(area);
    const renderedIds = idsIn(html);
    expect(new Set(renderedIds).size).toBe(renderedIds.length); // unique within the rendered tab

    const expectedIds = new Set<string>();
    const walk = (blocks: typeof area.blocks) => {
      for (const b of blocks) {
        if (b.t === "heading") expectedIds.add(b.id);
        if (b.t === "table") {
          if (b.id) expectedIds.add(b.id);
          if (b.bodyId) expectedIds.add(b.bodyId);
        }
        if (b.t === "controls" && !hasUnsafeControl(b.controls)) {
          for (const c of b.controls) if (c.id) expectedIds.add(c.id);
        }
        if (b.t === "checklist") for (const it2 of b.items) if (it2.control.id) expectedIds.add(it2.control.id);
        if (b.t === "card" || b.t === "grid" || b.t === "detail") walk(b.blocks);
      }
    };
    walk(area.blocks);

    const renderedIdSet = new Set(renderedIds);
    for (const expected of expectedIds) {
      const namespaced = sourceReferenceId(areaId, expected)!;
      expect(renderedIdSet.has(namespaced), `expected source id "${expected}" to be rendered as "${namespaced}"`).toBe(true);
    }
  });

  it("namespaces source ids so they cannot collide with live database-backed editors", () => {
    for (const area of MARKETING_WORKSPACE_CONTENT) {
      const html = renderArea(area);
      for (const id of idsIn(html)) expect(id.startsWith(`source-ref-${area.id}-`)).toBe(true);
    }
  });

  it("renders exactly 125 headings and 51 tables in total across all 25 real renders (matches the independent oracle)", () => {
    let headingTagCount = 0;
    let tableTagCount = 0;
    for (const area of MARKETING_WORKSPACE_CONTENT) {
      const html = renderArea(area);
      headingTagCount += [...html.matchAll(/<h[23]\b/g)].length;
      tableTagCount += [...html.matchAll(/<table\b/g)].length;
    }
    expect(headingTagCount).toBe(MARKETING_SOURCE_ORACLE.counts.headings);
    expect(headingTagCount).toBe(125);
    expect(tableTagCount).toBe(MARKETING_SOURCE_ORACLE.counts.tables);
    expect(tableTagCount).toBe(51);
  });

  it("gives every safe source control an explicit database-draft or live-workflow binding", () => {
    let expectedSafeControls = 0;
    let renderedBindings = 0;
    const walk = (blocks: (typeof MARKETING_WORKSPACE_CONTENT)[number]["blocks"]) => {
      for (const block of blocks) {
        if (block.t === "controls") expectedSafeControls += hasUnsafeControl(block.controls) ? 0 : block.controls.length;
        if (block.t === "checklist") expectedSafeControls += block.items.length;
        if (block.t === "table") {
          for (const row of block.rows) for (const cell of row) expectedSafeControls += cell.controls?.length ?? 0;
        }
        if (block.t === "card" || block.t === "grid" || block.t === "detail") walk(block.blocks);
      }
    };
    for (const area of MARKETING_WORKSPACE_CONTENT) {
      walk(area.blocks);
      renderedBindings += [...renderArea(area).matchAll(/data-source-binding="(database-draft|live-workflow)"/g)].length;
    }
    expect(renderedBindings).toBe(expectedSafeControls);
    expect(renderedBindings).toBeGreaterThan(240);
  });

  it("replaces the Apps Script auto-send control with a disabled safety notice — never a usable URL input", () => {
    const gmail = MARKETING_WORKSPACE_CONTENT.find((a) => a.id === "gmail")!;
    const html = renderArea(gmail);
    expect(html).toContain('data-safety-notice="apps-script-auto-send-disabled"');
    expect(html).not.toContain("webAppUrl");
    expect(html).not.toContain("batchLimit");
    expect(html).not.toMatch(/runAppsScript/);
    expect(html).not.toContain("script.google.com");
  });

  it("flags the disputed ~5,000-palm claim inline wherever it appears in plain source text", () => {
    let sawDisputedMark = false;
    for (const area of MARKETING_WORKSPACE_CONTENT) {
      const html = renderArea(area);
      if (html.includes("<mark")) sawDisputedMark = true;
    }
    expect(sawDisputedMark).toBe(true);
  });

  it("flags the disputed palm-count claim under any legacy textarea/template body that repeats it", () => {
    let sawTextareaWarning = false;
    for (const area of MARKETING_WORKSPACE_CONTENT) {
      const html = renderArea(area);
      if (html.includes("data-disputed-claim-warning")) sawTextareaWarning = true;
    }
    expect(sawTextareaWarning).toBe(true);
  });

  it("never uses dangerouslySetInnerHTML as a JSX prop (no raw source markup is ever injected)", () => {
    const src = readFileSync(resolve(__dirname, "SourceContentRenderer.tsx"), "utf8");
    // The word appears once, in the file's own explanatory header comment — check for actual usage
    // (`dangerouslySetInnerHTML={`/`=...`), not the substring, so that comment doesn't false-fail this.
    expect(src).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });
});
