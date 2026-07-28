import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract guard for the authenticated app shell's server/client render parity.
 *
 * WHY THIS EXISTS
 *
 * `AppChrome` is a client component that wraps every streamed Server Component page in
 * `app/(app)`. Anything it renders is part of the initial HTML of every authenticated
 * route, so it must produce IDENTICAL server and client initial markup.
 *
 * `next/dynamic(..., { ssr: false })` does NOT do that. In the App Router it is
 * implemented (next/dist/shared/lib/lazy-dynamic/loadable.js) as:
 *
 *     <Suspense fallback={<Loading/>}>
 *       <BailoutToCSR>          // throws BailoutToCSRError when typeof window === "undefined"
 *         <Lazy {...props} />
 *       </BailoutToCSR>
 *     </Suspense>
 *
 * so the server renders that subtree by THROWING. React Fizz emits an errored boundary —
 * `<!--$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template>…fallback…<!--/$-->`
 * — and the client discards the server HTML and re-renders the boundary. The shell therefore
 * ships two topbar controls whose server markup is thrown away on every page load, and the
 * shell's hydration runs through React's error-recovery path instead of a plain hydrate.
 *
 * Both shell controls are provably SSR-safe (HelpDrawer: `useState` + the pure `helpForPath`;
 * CommandPalette: reads `navigator` only via `useSyncExternalStore` with a stable server
 * snapshot), so `ssr: false` buys nothing and costs render parity. Import them statically.
 *
 * This is deliberately NOT a blanket ban on `next/dynamic` — only on SSR-disabled dynamic
 * imports inside the shell, and only while the shell is the sole `next/dynamic` user.
 *
 * NOTE: `suppressHydrationWarning` is not an acceptable way to satisfy this contract; it
 * hides a mismatch instead of removing it (Next.js documents it as an escape hatch for
 * deliberately unavoidable mismatches only). It is asserted absent below.
 */

const APP_ROOT = process.cwd();
const APP_CHROME = join(APP_ROOT, "components", "AppChrome.tsx");
const APP_LAYOUT = join(APP_ROOT, "app", "(app)", "layout.tsx");

function chromeSource(): string {
  return readFileSync(APP_CHROME, "utf8");
}

describe("app shell renders identical server and client initial markup", () => {
  it("does not disable SSR for anything rendered in the shell", () => {
    const src = chromeSource();
    expect(src).not.toMatch(/ssr\s*:\s*false/);
  });

  it("does not lazy-load shell chrome through next/dynamic at all", () => {
    // With `ssr: false` gone the only remaining reason to reach for next/dynamic here would
    // be code-splitting, which reintroduces a Suspense boundary into the shell's critical
    // markup. Keep the shell statically imported.
    const src = chromeSource();
    expect(src).not.toContain("next/dynamic");
  });

  it("does not paper over a mismatch with suppressHydrationWarning", () => {
    expect(chromeSource()).not.toContain("suppressHydrationWarning");
    expect(readFileSync(APP_LAYOUT, "utf8")).not.toContain("suppressHydrationWarning");
  });
});

describe("app shell keeps the HelpDrawer and CommandPalette behaviour", () => {
  it("still imports both components from their own modules", () => {
    const src = chromeSource();
    expect(src).toMatch(/import\s*\{[^}]*\bHelpDrawer\b[^}]*\}\s*from\s*"@\/components\/HelpDrawer"/);
    expect(src).toMatch(
      /import\s*\{[^}]*\bCommandPalette\b[^}]*\}\s*from\s*"@\/components\/CommandPalette"/,
    );
  });

  it("still mounts both in the topbar with their existing props", () => {
    const src = chromeSource();
    expect(src).toContain("<CommandPalette modules={modules} />");
    expect(src).toContain("<HelpDrawer pathname={pathname} fallbackHelpId={activeNavId} />");
  });

  it("keeps the command palette mounted exactly once (the single-listener contract)", () => {
    expect(chromeSource().match(/<CommandPalette\b/g)?.length ?? 0).toBe(1);
  });
});
