# @amrebeid/ui

**An Arabic-RTL-first design system for Farm OS — نظام تشغيل المزارع.**

A themeable, accessible, token-driven React component library for building Farm OS — a multi-tenant SaaS for date-palm and fruit farms across Egypt and MENA.

> **Status:** `1.0.0`, publish-ready (full v1 catalog, a11y-clean, token-pure, typed, green CI). Published to a **private** GitHub Packages registry under the `@amrebeid` scope. See [Status & license](#status--license).

---

## Install

Scoped under `@amrebeid` on GitHub Packages (private). With an `.npmrc` pointing the scope at the registry and a `read:packages` token (see [CONTRIBUTING.md](../../CONTRIBUTING.md)):

```bash
npm install @amrebeid/ui
```

> Within this monorepo, the app at `apps/farm-os` consumes it via the workspace (no registry needed).

`react` and `react-dom` (`>=18`, incl. React 19) and `recharts` (`>=2`, for the chart wrappers) are peer dependencies — your app provides them.

---

## Quick start

Import the stylesheet **once** at your app root, wrap your tree in `ThemeProvider`, and render components.

```tsx
import "@amrebeid/ui/styles.css";
import { ThemeProvider, Button, KpiCard } from "@amrebeid/ui";

export function App() {
  return (
    <ThemeProvider scheme="light" density="comfortable">
      <KpiCard label="الإنتاج اليومي" value="١٢٤ كجم" />
      <Button variant="primary">حفظ</Button>
    </ThemeProvider>
  );
}
```

The library is **presentational only** — it ships no strings and no i18n. Your app passes all text and owns translation; both RTL and LTR are supported via `dir` + logical CSS.

---

## Theming

Theming is a pure CSS-variable cascade applied by `ThemeProvider` — no re-render on change, SSR-safe (set it server-side, no flash). Four independent dimensions compose freely:

| Dimension | Values | Default |
|---|---|---|
| `scheme` | `light` · `dark` | `light` |
| `density` | `comfortable` · `compact` | `comfortable` |
| `radius` | `sharp` · `default` · `rounded` | `default` |
| `brand` | one hex color → derived `--brand` / `--brand-hover` / `--brand-contrast` | unset (Farm OS green) |

```tsx
<ThemeProvider scheme="dark" density="compact" radius="rounded" brand="#2f7d49">
  <App />
</ThemeProvider>
```

`useTheme()` reads the current values inside the tree. For non-React or framework-agnostic setups, set `data-theme` / `data-density` / `data-radius` and the brand vars directly on a scope element — `ThemeProvider` is a convenience over that mechanism.

See the **Foundations → Theming** and **Foundations → Getting Started** pages in Storybook for the full guide.

---

## Components

The full **v1 catalog** is shipped (`1.0.0`):

| Group | Components |
|---|---|
| **Forms** | `Button`, `IconButton`, `Field`, `Input`, `Textarea`, `NumberField`, `Select`, `Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `DateField`, `FormRow` |
| **Data display** | `Tag`, `Card`, `KpiCard`, `Progress`, `Stat`, `DataTable`, `Timeline`, `DescriptionList`, `Avatar`, `Tooltip`, `Pagination`, `EmptyState`, `Skeleton` |
| **Feedback / overlays** | `Alert`, `Toast` + `Toaster` + `useToast`, `Modal`, `Drawer`, `ConfirmDialog` |
| **Navigation / shell** | `Tabs`, `AppShell`, `SidebarNav`, `Breadcrumbs`, `RoleSwitcher`, `SearchInput` |
| **Charts** (theme-aware Recharts wrappers) | `BarChart`, `LineChart`, `DoughnutChart`, `useChartTokens` |
| **Domain (Farm OS)** | `VerdictBanner`, `LoopStepper`, `PhaseCard`, `StatusPill`, `PalmGrid`, `FileTimeline`, `ApprovalChain` |

Each export ships with its prop types (e.g. `ButtonProps`, `ButtonVariant`, `TagTone`, `AlertTone`). The theme API (`ThemeProvider`, `useTheme`, `brandVars`, and the `ThemeScheme` / `Density` / `Radius` types) is re-exported from the package root. **Recharts** is a peer dependency (used by the chart wrappers). Every component is token-pure, a11y-tested (jest-axe), and RTL-first; 176 tests pass under green CI.

---

## Architecture

- **Two-tier tokens.** Tier 1 *primitives* (`src/styles/primitives.css`) are theme-agnostic constants — color ramps (`--green-*`, `--gold-*`, neutral `--gray-*`, status hues) plus numeric scales for space, radius, type, shadow, z-index, and motion. Tier 2 *role tokens* (`src/styles/theme.css`) are what components reference — `--brand`, `--surface`, `--ink`, `--line`, `--focus-ring`, and the status pairs `--{success,warning,danger,info}-{bg,fg}`. Role tokens **flip per theme** under `[data-theme="dark"]`, `[data-density]`, and `[data-radius]`.
- **Components reference only role tokens** — never primitives, never raw values. This is what makes white-label themes apply cleanly.
- **Token-purity gate.** A build-time lint (`scripts/token-purity.mjs`) fails the build on any hardcoded hex / color / px in component CSS, enforcing the token discipline.
- **RTL-first.** Logical CSS properties throughout so layouts mirror correctly for Arabic without per-component overrides.

---

## Development

```bash
nvm use   # Node 20 (see .nvmrc)
npm install
```

| Script | What it does |
|---|---|
| `npm run dev` | tsup in watch mode |
| `npm run build` | token-purity gate → tsup (ESM + CJS + `.d.ts`) → bundled `styles.css` |
| `npm test` | run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | strict `tsc --noEmit` |
| `npm run storybook` | Storybook dev server on port 6006 |
| `npm run build-storybook` | static Storybook build (canonical docs) |
| `npm run tokens:present` | check the expected token set is present |
| `npm run tokens:purity` | token-purity lint (no hardcoded colors/px in components) |

**Node:** `20` (pinned in `.nvmrc`).

---

## Testing & quality gate

A component is done only when it passes the publish-ready gate:

- **Types** — strict `tsc`; public API fully typed, no `any` leaks.
- **Behavior** — Vitest + Testing Library (controlled state, keyboard, focus).
- **A11y** — jest-axe assertions, zero violations.
- **Token-purity** — `tokens:purity` lint, no hardcoded values outside the token system.
- **Theme matrix** — key components rendered across light/dark × comfortable/compact (`test/theme-matrix.test.tsx`).

---

## Status & license

- **`UNLICENSED`** — published to a **private** registry (GitHub Packages, `@amrebeid` scope), not public.
- **`1.0.0`** — the publish-ready milestone is reached: full v1 catalog, a11y-clean, token-pure, typed, documented, green CI. Versioned with Changesets.
- Built to a **public-quality bar** so nothing blocks going public later.
