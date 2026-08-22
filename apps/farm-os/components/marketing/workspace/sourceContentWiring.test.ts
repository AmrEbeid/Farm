import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SPEC-0032 — closes the review gap directly: `SourceContentRenderer.test.tsx` proves the renderer
 * itself really renders all 25 generated areas with exact ids; this file proves the component the
 * app actually mounts (`WorkspaceArea.tsx`, the one `app/(app)/marketing/workspace/page.tsx` builds
 * every tab panel from) really calls that exact renderer with the real generated content — not a
 * second, detached copy. Static source inspection (not execution) is used here because
 * `WorkspaceArea`'s sibling panels are "use client" components that call `useRouter()`/`useToast()`,
 * which throw outside a mounted Next router / `<ToastProvider>` — full-tree rendering would need
 * `jsdom` + `@testing-library/react`, new dev dependencies this change does not add.
 */
describe("WorkspaceArea wires the real SourceContentRenderer + generated content (not just the blueprint)", () => {
  const src = readFileSync(resolve(__dirname, "WorkspaceArea.tsx"), "utf8");

  it("imports the real generated content module (content.generated.ts), not a re-derived summary", () => {
    expect(src).toMatch(/import\s*\{\s*MARKETING_WORKSPACE_CONTENT\s*\}\s*from\s*"@\/lib\/marketing\/workspace\/content\.generated"/);
  });

  it("imports and renders SourceContentRenderer for the resolved area content", () => {
    expect(src).toMatch(/import\s*\{\s*SourceContentRenderer\s*\}\s*from\s*"\.\/SourceContentRenderer"/);
    expect(src).toMatch(/<SourceContentRenderer[\s\S]*area=\{sourceContent\}[\s\S]*values=\{data\.sourceControlValues\}[\s\S]*\/>/);
  });

  it("resolves sourceContent by the exact area id (SOURCE_CONTENT_BY_AREA keyed off MARKETING_WORKSPACE_CONTENT)", () => {
    expect(src).toMatch(/SOURCE_CONTENT_BY_AREA\s*=\s*new Map\(MARKETING_WORKSPACE_CONTENT\.map/);
    expect(src).toMatch(/const sourceContent = SOURCE_CONTENT_BY_AREA\.get\(area\.sourceId\)/);
  });
});
