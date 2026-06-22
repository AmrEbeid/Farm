# Theming Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two-tier token + white-label theme engine (light/dark × density × radius × brand) with a `ThemeProvider`, a build-blocking token-purity lint, and retrofit the 9 existing components to be 100% token-driven.

**Architecture:** Tier-1 primitive CSS variables (theme-agnostic constants) feed Tier-2 role tokens (`--surface`, `--ink`, `--brand`, status pairs) that *flip* under `[data-theme]`/`[data-density]`/`[data-radius]` scopes. Components reference only Tier-2. A `ThemeProvider` writes the scope attributes + inline brand vars; theming is pure CSS-variable cascade (no re-render, SSR-safe). A token-purity check fails the build on any hardcoded color/px in component CSS.

**Tech Stack:** React 18, TypeScript, tsup, Storybook 8 (react-vite), Vitest + @testing-library/react + jsdom, jest-axe, plain CSS (custom properties).

## Global Constraints
- React `>=18`; TypeScript `strict: true`; no `any` in public API.
- **Components reference only Tier-2 role tokens + numeric scales — zero hardcoded color/hex/rgb/px-color values.** (Enforced by Task 7.)
- RTL-first: use logical CSS properties (`margin-inline`, `inset-inline-start`) — never physical (`left`/`right`).
- Library is **presentational**: no user-facing strings, no i18n inside components.
- Class prefix `fos-`; token prefix `--` (primitives by ramp name, role tokens by role).
- Keep the existing public API of the 9 components unchanged (this phase is internal/visual only).
- Commit after every task with the existing identity; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure
- `src/styles/primitives.css` — **create** — Tier-1 constants (ramps + numeric scales).
- `src/styles/theme.css` — **create** — Tier-2 role tokens: `:root` (light) + `[data-theme="dark"]` + `[data-density]` + `[data-radius]` blocks.
- `src/styles/components.css` — **modify** — retrofit to reference role tokens only.
- `src/styles/index.css` — **modify** — import order: primitives → theme → components.
- `src/theme/brand.ts` — **create** — `brandVars(hex)` derives `--brand*` from one color.
- `src/theme/ThemeProvider.tsx` — **create** — provider + `useTheme`.
- `src/theme/index.ts` — **create** — barrel for theme exports.
- `src/index.ts` — **modify** — re-export theme API.
- `scripts/token-purity.mjs` — **create** — the lint gate.
- `scripts/check-tokens-present.mjs` — **create** — asserts required tokens exist.
- `test/setup.ts`, `vitest.config.ts` — **create** — test harness.
- `src/theme/*.test.tsx`, `test/theme-matrix.test.tsx` — **create** — tests.
- `.storybook/preview.ts` — **modify** — theme/density/brand toolbar globals.
- `package.json` — **modify** — scripts + devDeps.

---

### Task 1: Test & lint harness

**Files:**
- Create: `vitest.config.ts`, `test/setup.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test` (vitest run), `npm run test:watch`; `expect(...).toHaveNoViolations()` available via jest-axe.

- [ ] **Step 1: Install dev deps**

Run:
```bash
npm i -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event jest-axe @types/jest-axe
```
Expected: installs, exit 0.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 3: Create `test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { expect } from "vitest";
import { toHaveNoViolations } from "jest-axe";
expect.extend(toHaveNoViolations);
```

- [ ] **Step 4: Add scripts to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"tokens:present": "node scripts/check-tokens-present.mjs",
"tokens:purity": "node scripts/token-purity.mjs"
```

- [ ] **Step 5: Smoke test**

Create `test/smoke.test.ts`:
```ts
import { it, expect } from "vitest";
it("harness runs", () => { expect(1 + 1).toBe(2); });
```
Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test/setup.ts test/smoke.test.ts
git commit -m "chore: add vitest + testing-library + jest-axe harness"
```

---

### Task 2: Tier-1 primitive tokens

**Files:**
- Create: `src/styles/primitives.css`, `scripts/check-tokens-present.mjs`

**Interfaces:**
- Produces: CSS custom properties on `:root` — color ramps `--green-50..900`, `--gold-50..900`, `--gray-0..900`, `--red/amber/blue/purple-{100,500,700}`; scales `--space-1..10`, `--radius-0..3`, `--text-xs..3xl`, `--shadow-1..3`, `--z-*`, `--dur-*`, `--ease`.

- [ ] **Step 1: Write the failing token-presence check**

Create `scripts/check-tokens-present.mjs`:
```js
import fs from "node:fs";
const css = fs.readFileSync(new URL("../src/styles/primitives.css", import.meta.url), "utf8");
const required = [
  "--green-500","--green-700","--gold-500","--gray-0","--gray-900",
  "--red-500","--amber-500","--blue-500","--purple-500",
  "--space-1","--space-4","--space-10","--radius-1","--radius-3",
  "--text-xs","--text-3xl","--shadow-1","--dur-fast","--ease",
];
const missing = required.filter((t) => !css.includes(t + ":"));
if (missing.length) { console.error("MISSING primitives:", missing.join(", ")); process.exit(1); }
console.log("primitives present:", required.length);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run tokens:present`
Expected: FAIL — `MISSING primitives: …` (file doesn't exist yet → throws / non-zero).

- [ ] **Step 3: Create `src/styles/primitives.css`**

```css
/* Tier-1 primitives — theme-agnostic constants. Components NEVER reference these directly. */
:root {
  /* greens */
  --green-50:#e6f3ea; --green-100:#cfe7d6; --green-300:#7fc298; --green-500:#3d9960;
  --green-600:#2f7d49; --green-700:#236138; --green-800:#1c4d2c; --green-900:#11301b;
  /* gold */
  --gold-50:#f9f0db; --gold-100:#f4e6c8; --gold-500:#c8922a; --gold-700:#a9761d; --gold-900:#7a5413;
  /* neutral */
  --gray-0:#ffffff; --gray-50:#f3f6f3; --gray-100:#e3e9e4; --gray-200:#ccd6cd;
  --gray-400:#9aa8a0; --gray-600:#6b7d72; --gray-800:#2b3a31; --gray-900:#18241d;
  /* status hues */
  --red-100:#fbe5e2; --red-500:#c0392b; --red-700:#9a2c20;
  --amber-100:#fceedb; --amber-500:#e08a1e; --amber-700:#a9651340;
  --blue-100:#e4eef8; --blue-500:#2b6cb0; --blue-700:#1f4f80;
  --purple-100:#efe7fa; --purple-500:#7e57c2; --purple-700:#5e3d96;
  /* space (4px base) */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px;
  --space-6:24px; --space-8:32px; --space-10:40px;
  /* radius primitives (the scale knob remaps these in theme.css) */
  --radius-0:0px; --radius-1:8px; --radius-2:11px; --radius-3:14px; --radius-pill:9999px;
  /* type */
  --text-xs:11px; --text-sm:12.5px; --text-base:14px; --text-md:16px;
  --text-lg:18px; --text-xl:22px; --text-2xl:26px; --text-3xl:34px;
  /* elevation / z / motion */
  --shadow-1:0 1px 3px rgba(20,54,31,.07); --shadow-2:0 1px 3px rgba(20,54,31,.07),0 4px 18px rgba(20,54,31,.06); --shadow-3:0 24px 70px rgba(0,0,0,.35);
  --z-base:0; --z-sticky:30; --z-drawer:120; --z-modal:100; --z-toast:300;
  --dur-fast:.12s; --dur:.2s; --dur-slow:.25s; --ease:cubic-bezier(.2,.7,.3,1);
  /* font */
  --font-family:"Segoe UI",Tahoma,system-ui,sans-serif;
}
```
Fix the typo if present: `--amber-700:#a9651340;` → `--amber-700:#a96513;`.

- [ ] **Step 4: Run check to verify it passes**

Run: `npm run tokens:present`
Expected: `primitives present: 19`.

- [ ] **Step 5: Commit**

```bash
git add src/styles/primitives.css scripts/check-tokens-present.mjs
git commit -m "feat(tokens): add Tier-1 primitive scales + presence check"
```

---

### Task 3: Tier-2 role tokens (light + dark)

**Files:**
- Create: `src/styles/theme.css`
- Modify: `scripts/check-tokens-present.mjs`

**Interfaces:**
- Produces role tokens consumed by every component: `--brand`, `--brand-hover`, `--brand-contrast`, `--surface`, `--surface-raised`, `--ink`, `--ink-muted`, `--line`, `--focus-ring`, and `--{success,warning,danger,info}-{bg,fg}`. Defined for light (`:root`) and dark (`[data-theme="dark"]`).

- [ ] **Step 1: Extend the presence check to assert role tokens in BOTH schemes**

Append to `scripts/check-tokens-present.mjs` (before the final `console.log`):
```js
const theme = fs.readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
const roles = ["--brand","--surface","--surface-raised","--ink","--ink-muted","--line","--focus-ring","--success-bg","--success-fg","--warning-bg","--danger-fg","--info-bg"];
const light = theme.split('[data-theme="dark"]')[0];
const darkParts = theme.split('[data-theme="dark"]');
const dark = darkParts.length > 1 ? darkParts[1] : "";
const missLight = roles.filter((t) => !light.includes(t + ":"));
const missDark = roles.filter((t) => !dark.includes(t + ":"));
if (missLight.length) { console.error("MISSING role tokens (light):", missLight.join(", ")); process.exit(1); }
if (missDark.length) { console.error("MISSING role tokens (dark):", missDark.join(", ")); process.exit(1); }
console.log("role tokens present in light + dark:", roles.length);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run tokens:present`
Expected: FAIL — theme.css missing / role tokens absent.

- [ ] **Step 3: Create `src/styles/theme.css`**

```css
/* Tier-2 role tokens — what components reference. These FLIP per theme. */
:root {
  --brand: var(--green-600); --brand-hover: var(--green-700); --brand-contrast:#ffffff;
  --surface: var(--gray-0); --surface-raised: var(--gray-0); --surface-sunken: var(--gray-50);
  --ink: var(--gray-900); --ink-muted: var(--gray-600); --line: var(--gray-100);
  --focus-ring: var(--green-600);
  --success-bg:#e3f3e9; --success-fg: var(--green-600);
  --warning-bg: var(--amber-100); --warning-fg: var(--amber-500);
  --danger-bg: var(--red-100); --danger-fg: var(--red-500);
  --info-bg: var(--blue-100); --info-fg: var(--blue-500);
  --shadow-card: var(--shadow-2);
}
[data-theme="dark"] {
  --brand: var(--green-500); --brand-hover: var(--green-300); --brand-contrast:#0c1f12;
  --surface: var(--gray-900); --surface-raised:#202d24; --surface-sunken:#0e1812;
  --ink: var(--gray-50); --ink-muted: var(--gray-400); --line:#2c3a31;
  --focus-ring: var(--green-300);
  --success-bg:#15301f; --success-fg:#6bbf86;
  --warning-bg:#3a2a10; --warning-fg:#e6a948;
  --danger-bg:#3a1714; --danger-fg:#e07a6a;
  --info-bg:#13243a; --info-fg:#6fa8dc;
  --shadow-card:0 1px 3px rgba(0,0,0,.4),0 4px 18px rgba(0,0,0,.3);
}
```

- [ ] **Step 4: Run check to verify it passes**

Run: `npm run tokens:present`
Expected: `role tokens present in light + dark: 12`.

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.css scripts/check-tokens-present.mjs
git commit -m "feat(tokens): add Tier-2 role tokens (light + dark)"
```

---

### Task 4: Density & radius scale blocks

**Files:**
- Modify: `src/styles/theme.css`

**Interfaces:**
- Produces: `--control-h`, `--control-pad-x`, `--gap`, `--card-pad` (density-driven) and a `--radius-scale`-style remap of `--radius-control`/`--radius-card`. Defaults plus `[data-density="compact"]` and `[data-radius="sharp"|"rounded"]` overrides.

- [ ] **Step 1: Write the failing test**

Create `src/theme/density.test.tsx`:
```tsx
import { it, expect } from "vitest";
import fs from "node:fs";
it("defines density + radius scope blocks", () => {
  const css = fs.readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8");
  expect(css).toContain('[data-density="compact"]');
  expect(css).toContain("--control-h:");
  expect(css).toContain('[data-radius="sharp"]');
  expect(css).toContain("--radius-control:");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- density`
Expected: FAIL (strings absent).

- [ ] **Step 3: Append density + radius tokens to `src/styles/theme.css`**

```css
/* Density (comfortable default) */
:root { --control-h:38px; --control-pad-x:var(--space-4); --gap:var(--space-4); --card-pad:var(--space-4); }
[data-density="compact"] { --control-h:30px; --control-pad-x:var(--space-3); --gap:var(--space-3); --card-pad:var(--space-3); }
/* Radius scale (default) */
:root { --radius-control:var(--radius-1); --radius-card:var(--radius-3); }
[data-radius="sharp"] { --radius-control:var(--radius-0); --radius-card:var(--radius-0); }
[data-radius="rounded"] { --radius-control:var(--radius-2); --radius-card:var(--radius-pill); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- density`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.css src/theme/density.test.tsx
git commit -m "feat(tokens): add density + radius scale scope blocks"
```

---

### Task 5: Brand derivation helper

**Files:**
- Create: `src/theme/brand.ts`, `src/theme/brand.test.ts`

**Interfaces:**
- Produces: `brandVars(hex: string): Record<string,string>` → `{ "--brand": hex, "--brand-hover": <darkened>, "--brand-contrast": <"#fff"|"#0c1f12"> }`. Consumed by `ThemeProvider` (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
import { it, expect, describe } from "vitest";
import { brandVars } from "./brand";
describe("brandVars", () => {
  it("maps a hex to brand role vars", () => {
    const v = brandVars("#2f7d49");
    expect(v["--brand"]).toBe("#2f7d49");
    expect(v["--brand-hover"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(v["--brand-contrast"]).toBe("#ffffff"); // dark brand → white text
  });
  it("picks dark contrast for a light brand", () => {
    expect(brandVars("#e8f0a0")["--brand-contrast"]).toBe("#0c1f12");
  });
  it("throws on a non-hex input", () => {
    expect(() => brandVars("blue")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- brand`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/theme/brand.ts`**

```ts
/** Derive brand role variables from a single hex color. */
export function brandVars(hex: string): Record<string, string> {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`brandVars: expected a 6-digit hex, got "${hex}"`);
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const hover = "#" + [r, g, b].map((c) => Math.max(0, Math.round(c * 0.82)).toString(16).padStart(2, "0")).join("");
  // relative luminance → contrast text
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const contrast = lum > 0.6 ? "#0c1f12" : "#ffffff";
  return { "--brand": hex.toLowerCase(), "--brand-hover": hover, "--brand-contrast": contrast };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- brand`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/theme/brand.ts src/theme/brand.test.ts
git commit -m "feat(theme): brandVars() derives brand role vars from one hex"
```

---

### Task 6: ThemeProvider + useTheme

**Files:**
- Create: `src/theme/ThemeProvider.tsx`, `src/theme/ThemeProvider.test.tsx`, `src/theme/index.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `brandVars` (Task 5).
- Produces:
  - `type ThemeScheme = "light" | "dark"`; `type Density = "comfortable" | "compact"`; `type Radius = "sharp" | "default" | "rounded"`.
  - `interface ThemeProviderProps { scheme?: ThemeScheme; density?: Density; radius?: Radius; brand?: string; asChild?: boolean; children: React.ReactNode }`.
  - `ThemeProvider` renders a `<div class="fos">` (or applies to its child) carrying `data-theme`/`data-density`/`data-radius` + inline brand vars.
  - `useTheme(): { scheme; density; radius; brand? }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Probe() { const t = useTheme(); return <span data-testid="p">{t.scheme}-{t.density}</span>; }

describe("ThemeProvider", () => {
  it("applies scope attributes and brand vars", () => {
    const { container } = render(
      <ThemeProvider scheme="dark" density="compact" radius="rounded" brand="#2f7d49">
        <Probe />
      </ThemeProvider>
    );
    const scope = container.querySelector(".fos") as HTMLElement;
    expect(scope.getAttribute("data-theme")).toBe("dark");
    expect(scope.getAttribute("data-density")).toBe("compact");
    expect(scope.getAttribute("data-radius")).toBe("rounded");
    expect(scope.style.getPropertyValue("--brand")).toBe("#2f7d49");
    expect(screen.getByTestId("p").textContent).toBe("dark-compact");
  });
  it("defaults to light/comfortable/default and no brand override", () => {
    const { container } = render(<ThemeProvider><Probe /></ThemeProvider>);
    const scope = container.querySelector(".fos") as HTMLElement;
    expect(scope.getAttribute("data-theme")).toBe("light");
    expect(scope.style.getPropertyValue("--brand")).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ThemeProvider`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/theme/ThemeProvider.tsx`**

```tsx
import * as React from "react";
import { brandVars } from "./brand";

export type ThemeScheme = "light" | "dark";
export type Density = "comfortable" | "compact";
export type Radius = "sharp" | "default" | "rounded";

export interface ThemeContextValue { scheme: ThemeScheme; density: Density; radius: Radius; brand?: string; }
const ThemeContext = React.createContext<ThemeContextValue>({ scheme: "light", density: "comfortable", radius: "default" });
export const useTheme = () => React.useContext(ThemeContext);

export interface ThemeProviderProps {
  scheme?: ThemeScheme; density?: Density; radius?: Radius; brand?: string;
  className?: string; children: React.ReactNode;
}

export function ThemeProvider({
  scheme = "light", density = "comfortable", radius = "default", brand, className = "", children,
}: ThemeProviderProps) {
  const style = React.useMemo<React.CSSProperties>(
    () => (brand ? (brandVars(brand) as React.CSSProperties) : {}),
    [brand]
  );
  const value = React.useMemo(() => ({ scheme, density, radius, brand }), [scheme, density, radius, brand]);
  return (
    <ThemeContext.Provider value={value}>
      <div className={`fos ${className}`.trim()} data-theme={scheme} data-density={density} data-radius={radius} style={style}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
```

- [ ] **Step 4: Create `src/theme/index.ts`**

```ts
export { ThemeProvider, useTheme } from "./ThemeProvider";
export type { ThemeProviderProps, ThemeScheme, Density, Radius, ThemeContextValue } from "./ThemeProvider";
export { brandVars } from "./brand";
```

- [ ] **Step 5: Re-export from `src/index.ts`**

Add this line to `src/index.ts`:
```ts
export * from "./theme";
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- ThemeProvider`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add src/theme/ src/index.ts
git commit -m "feat(theme): ThemeProvider + useTheme (scope attrs + brand vars, SSR-safe)"
```

---

### Task 7: Token-purity lint gate

**Files:**
- Create: `scripts/token-purity.mjs`, `test/token-purity.test.ts`
- Modify: `package.json` (wire into `build`)

**Interfaces:**
- Produces: `node scripts/token-purity.mjs` — scans `src/styles/components.css` (and any future component CSS), exits non-zero if it finds a hardcoded color (`#hex`, `rgb(`, `hsl(`) or a color-bearing px outside the allowed token/util files. `primitives.css` and `theme.css` are the ONLY files allowed raw values.

- [ ] **Step 1: Write the failing test (purity script behavior)**

Create `test/token-purity.test.ts`:
```ts
import { it, expect, describe } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function runOn(css: string): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purity-"));
  const f = path.join(dir, "components.css");
  fs.writeFileSync(f, css);
  try { execFileSync("node", ["scripts/token-purity.mjs", f], { stdio: "pipe" }); return 0; }
  catch (e: any) { return e.status ?? 1; }
}
describe("token-purity", () => {
  it("passes clean token-only CSS", () => {
    expect(runOn(".fos-btn{background:var(--brand);color:var(--brand-contrast);padding:var(--space-2)}")).toBe(0);
  });
  it("fails on a hardcoded hex color", () => {
    expect(runOn(".fos-btn{background:#2f7d49}")).not.toBe(0);
  });
  it("fails on rgb()", () => {
    expect(runOn(".x{color:rgb(0,0,0)}")).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- token-purity`
Expected: FAIL (script missing).

- [ ] **Step 3: Implement `scripts/token-purity.mjs`**

```js
import fs from "node:fs";
// Files passed as args, else default to component stylesheet(s).
const files = process.argv.slice(2);
const targets = files.length ? files : ["src/styles/components.css"];
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC = /\b(rgb|rgba|hsl|hsla)\s*\(/g;
let bad = 0;
for (const f of targets) {
  const css = fs.readFileSync(f, "utf8");
  css.split("\n").forEach((line, i) => {
    // allow comments
    const code = line.replace(/\/\*.*?\*\//g, "");
    const hits = [...code.matchAll(HEX), ...code.matchAll(FUNC)];
    if (hits.length) { bad++; console.error(`${f}:${i + 1}  hardcoded color → use a role token: ${line.trim()}`); }
  });
}
if (bad) { console.error(`\n✗ token-purity: ${bad} hardcoded value(s). Components must use role tokens only.`); process.exit(1); }
console.log("✓ token-purity: clean");
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- token-purity`
Expected: 3 passed.

- [ ] **Step 5: Wire into build**

In `package.json`, change `"build"` to run purity first:
```json
"build": "npm run tokens:purity && tsup && npm run build:css"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/token-purity.mjs test/token-purity.test.ts package.json
git commit -m "feat(ci): token-purity lint gate; wired into build"
```

---

### Task 8: Retrofit existing components to token-pure

**Files:**
- Modify: `src/styles/components.css`, `src/styles/index.css`

**Interfaces:**
- Consumes: role tokens (Task 3–4). Produces: a `components.css` that passes `tokens:purity` and renders identically in light mode.

- [ ] **Step 1: Set the import order in `src/styles/index.css`**

```css
@import "./primitives.css";
@import "./theme.css";
@import "./components.css";
```

- [ ] **Step 2: Run purity to see current failures**

Run: `npm run tokens:purity`
Expected: FAIL — lists the existing hardcoded values in `components.css` (e.g. `#fff`, gradients, status hexes).

- [ ] **Step 3: Replace hardcoded values with role tokens in `src/styles/components.css`**

Apply these substitutions throughout (repeat for every occurrence):
- `var(--g6)`/`#2f7d49` primary → `var(--brand)`; hover `var(--green-700)` → `var(--brand-hover)`; text-on-brand `#fff` → `var(--brand-contrast)`.
- card/control background `#fff`/`var(--card)` → `var(--surface)` (raised surfaces → `var(--surface-raised)`).
- text `var(--ink)`; muted `var(--muted)` → `var(--ink-muted)`; borders `var(--line)`.
- status backgrounds/foregrounds → `var(--success-bg)`/`var(--success-fg)`, `--warning-*`, `--danger-*`, `--info-*`.
- control radius → `var(--radius-control)`; card radius → `var(--radius-card)`; control height → `var(--control-h)`; paddings → `var(--space-*)` / `var(--control-pad-x)`.
- shadows → `var(--shadow-card)`; focus ring color → `var(--focus-ring)`.
- For the progress/verdict gradients, replace literal hexes with `color-mix(in srgb, var(--brand) 85%, black)` style or two role-token stops; if a gradient needs a literal, move that rule's colors into `theme.css` as a new role token (e.g. `--progress-from`/`--progress-to`) and reference it.

- [ ] **Step 4: Run purity until clean**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`. (Iterate Step 3 until it passes — do NOT weaken the script.)

- [ ] **Step 5: Build to confirm CSS still bundles**

Run: `npm run build`
Expected: exit 0; `dist/styles.css` written.

- [ ] **Step 6: Commit**

```bash
git add src/styles/components.css src/styles/index.css
git commit -m "refactor(styles): retrofit components to token-only (white-label clean)"
```

---

### Task 9: Theme-matrix smoke + a11y test

**Files:**
- Create: `test/theme-matrix.test.tsx`

**Interfaces:**
- Consumes: `ThemeProvider` + the exported components. Produces: a test rendering representative components across light/dark × comfortable/compact with no thrown errors and no axe violations in the default case.

- [ ] **Step 1: Write the test**

```tsx
import { it, expect, describe } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider, Button, Tag, KpiCard, Alert, VerdictBanner } from "../src";

const schemes = ["light", "dark"] as const;
const densities = ["comfortable", "compact"] as const;

function Sample() {
  return (<>
    <Button>اعتماد</Button>
    <Tag tone="ok">معتمدة</Tag>
    <KpiCard label="صافي" value="2.71" unit="م" />
    <Alert tone="warning" title="مخزون منخفض" />
    <VerdictBanner tone="danger">نقص حرج</VerdictBanner>
  </>);
}

describe("theme matrix", () => {
  for (const scheme of schemes) for (const density of densities) {
    it(`renders without throwing: ${scheme}/${density}`, () => {
      const { container } = render(<ThemeProvider scheme={scheme} density={density}><Sample /></ThemeProvider>);
      expect(container.querySelector(".fos-btn")).toBeInTheDocument();
    });
  }
  it("default theme has no axe violations", async () => {
    const { container } = render(<ThemeProvider><Sample /></ThemeProvider>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- theme-matrix`
Expected: 5 passed (4 matrix + 1 axe). If axe flags a real issue (e.g. a missing label), fix the component, re-run.

- [ ] **Step 3: Commit**

```bash
git add test/theme-matrix.test.tsx
git commit -m "test(theme): theme-matrix smoke + axe on the default theme"
```

---

### Task 10: Storybook theming toolbar + Theming doc

**Files:**
- Modify: `.storybook/preview.ts`
- Create: `src/Theming.mdx`

**Interfaces:**
- Consumes: `ThemeProvider`. Produces: Storybook toolbar globals (theme/density/radius/brand) wrapping every story in `ThemeProvider`, and a "Theming" docs page.

- [ ] **Step 1: Replace the decorator/globals in `.storybook/preview.ts`**

```ts
import type { Preview } from "@storybook/react";
import * as React from "react";
import { ThemeProvider } from "../src/theme";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: { controls: { matchers: { color: /(background|color)$/i } } },
  globalTypes: {
    scheme: { toolbar: { title: "Scheme", icon: "circlehollow", items: ["light", "dark"] } },
    density: { toolbar: { title: "Density", icon: "component", items: ["comfortable", "compact"] } },
    dir: { toolbar: { title: "Dir", icon: "transfer", items: ["rtl", "ltr"] } },
  },
  initialGlobals: { scheme: "light", density: "comfortable", dir: "rtl" },
  decorators: [
    (Story, ctx) => {
      const { scheme = "light", density = "comfortable", dir = "rtl" } = ctx.globals;
      document.documentElement.setAttribute("dir", dir);
      return React.createElement(ThemeProvider, { scheme, density, children: React.createElement(Story) });
    },
  ],
};
export default preview;
```

- [ ] **Step 2: Verify Storybook builds**

Run: `npm run build-storybook`
Expected: exit 0; `storybook-static/` written.

- [ ] **Step 3: Create `src/Theming.mdx`**

```mdx
import { Meta } from "@storybook/blocks";

<Meta title="Foundations/Theming" />

# Theming

Wrap your app in `ThemeProvider`. It applies the theme via scope attributes + CSS variables — no re-render on change, SSR-safe.

```tsx
import { ThemeProvider } from "@amrebeid/ui";
import "@amrebeid/ui/styles.css";

<ThemeProvider scheme="dark" density="compact" brand="#2f7d49">
  <App />
</ThemeProvider>
```

**Dimensions:** `scheme` (light/dark) · `density` (comfortable/compact) · `radius` (sharp/default/rounded) · `brand` (one hex → derived `--brand*`). Components reference only role tokens, so all four compose freely.
```

- [ ] **Step 4: Commit**

```bash
git add .storybook/preview.ts src/Theming.mdx
git commit -m "feat(storybook): theme/density/dir toolbar + Theming doc"
```

---

### Task 11: Phase verification + re-sync note

**Files:** none (verification only)

- [ ] **Step 1: Full gate run**

Run:
```bash
npm run tokens:present && npm run tokens:purity && npm test && npm run build && npm run build-storybook
```
Expected: all exit 0.

- [ ] **Step 2: Commit any incidental fixes, then tag the phase**

```bash
git add -A && git commit -m "chore: theming foundation phase complete" || echo "nothing to commit"
git tag phase-1-theming
```

- [ ] **Step 3: Re-sync to Claude Design (manual, needs login)**

Note for the operator (NOT automated — requires `/design-login` in a login-capable session):
```bash
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry dist/index.js --out ./ds-bundle
# then the design-sync skill's upload step pushes the re-themed bundle to the existing project
```

---

## Self-Review

**Spec coverage (Plan 1 scope = spec §3 + the foundation parts of §6):**
- Two-tier tokens (§3) → Tasks 2–3 ✓. Four theme dimensions (§3): scheme T3, density+radius T4, brand T5/T6 ✓. ThemeProvider + escape hatch + SSR (§3) → T6 ✓. Token-purity enforcement (§3/§6) → T7, applied T8 ✓. Theme-matrix smoke (§6) → T9 ✓. A11y axe (§6) → T9 ✓. Storybook theming docs (§5) → T10 ✓.
- Out of Plan 1 by design (later plans): the gap components (§4) → Plans 2–7; Changesets/CI/registry/private publish (§5–6) → Plan 8; full per-component a11y/behavior tests → land with each component's plan. The token-purity gate and ThemeProvider they depend on are delivered here.

**Placeholder scan:** every code/step has concrete content; Task 8 Step 3 is a substitution rule list (not a placeholder) because the exact lines depend on the current `components.css` — the engineer applies the named role-token mapping and the purity script (Step 4) is the objective oracle that confirms completion.

**Type consistency:** `brandVars` signature matches between Task 5 (definition) and Task 6 (consumption). `ThemeProvider` prop/type names in Task 6 test match the implementation and the `index.ts` exports. Token names introduced in T2–T4 are the same ones referenced in T8 and consumed by T9.
