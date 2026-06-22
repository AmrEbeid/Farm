# @amrebeid/ui

**An Arabic-RTL-first design system for Farm OS — نظام تشغيل المزارع.**

A themeable, accessible, token-driven React component library for building Farm OS — a multi-tenant SaaS for date-palm and fruit farms across Egypt and MENA.

> **Status:** private, `0.1.0`, built to a public-quality bar but shipped privately first. The API still moves while we reach `1.0` (publish-ready). See [Status & license](#status--license).

---

## Install

The package is private and scoped under `@farm-os`. Once your environment is pointed at the private registry, install it like any scoped package:

```bash
npm install @amrebeid/ui
```

> Registry configuration (the `.npmrc` entry that resolves the `@farm-os` scope to the private registry) ships with the publish setup. Until then, `@amrebeid/ui` is consumed from within this workspace.

`react` and `react-dom` (`>=18`) are peer dependencies — your app provides them.

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

Currently shipped (`0.1.0`):

| Group | Components |
|---|---|
| **Forms** | `Button`, `Field` |
| **Data display** | `Tag`, `KpiCard`, `Progress`, `Card` |
| **Feedback** | `Alert` |
| **Navigation** | `Tabs` |
| **Domain (Farm OS)** | `VerdictBanner` |

Each export ships with its prop types (e.g. `ButtonProps`, `ButtonVariant`, `ButtonSize`, `TagTone`, `AlertTone`, `ProgressTone`, `VerdictTone`, `TabItem`). The theme API (`ThemeProvider`, `useTheme`, `brandVars`, and the `ThemeScheme` / `Density` / `Radius` types) is re-exported from the package root.

### Roadmap

These nine are the foundation; the full **v1 catalog** is planned and tracked in `docs/superpowers/plans/`:

- **Forms** — IconButton, Input/Textarea/NumberField, Select, Combobox, Checkbox, Radio, Switch, DateField, FormRow.
- **Data display** — Stat, DataTable, Timeline, DescriptionList, Avatar, Tooltip, Pagination, EmptyState, Skeleton.
- **Feedback / overlays** — Toast + Toaster, Modal/Dialog, Drawer/Sheet, ConfirmDialog.
- **Navigation / shell** — AppShell, SidebarNav/NavItem, Breadcrumbs, RoleSwitcher, SearchInput.
- **Charts** — theme-aware Bar / Line / Doughnut wrappers.
- **Domain (Farm OS)** — LoopStepper, PhaseCard, PalmGrid/PalmCell, FileTimeline, ApprovalChain, StatusPill.

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

- **Private** — `UNLICENSED`, not published publicly.
- **`0.x`** while the API is still moving; **`1.0` is the publish-ready milestone** (full v1 catalog, a11y-clean, token-pure, typed, documented).
- Built to a **public-quality bar** so nothing blocks going public later, but shipped to a private registry first.
