# CONTEXT — `@amrebeid/ui`

> Domain & architecture context for engineers and AI agents navigating this repo.
> For the *why* behind the big calls, see the ADRs in `docs/adr/`.

## What this is

`@amrebeid/ui` (نظام تشغيل المزارع) is the **design system / component library** for **Farm OS** — a generic, multi-tenant SaaS for date-palm and fruit farms in Egypt/MENA. It is **Arabic-RTL-first** and **presentational only**: components carry structure, styling, state, and a11y, but **no user-facing strings and no i18n** — the consuming app passes all text and owns translation.

Farm OS itself (screens, data, auth, workflows) is a *separate* sub-project built on top of this library. Ebeid Farm is dummy/seed/demo data, **not** the customer; nothing here is tenant-specific. This package is built to a **public-quality bar but shipped privately first** (see ADR-0006).

## Ubiquitous language (glossary)

- **Tier-1 primitive** — a theme-agnostic constant CSS variable: color ramps (`--green-500`, `--gray-0…900`, status hues) and numeric scales (`--space-*`, `--radius-*`, `--text-*`, `--shadow-*`, `--z-*`, `--dur-*`). Components **never** reference these directly.
- **Tier-2 role token** — a semantic variable that components *do* use and that **flips per theme**: `--brand`, `--surface`, `--ink`, `--line`, `--focus-ring`, the status pairs `--{success,warning,danger,info}-{bg,fg}`, and density/radius outputs (`--control-h`, `--radius-control`, …).
- **Theme dimensions** — four independent, composable knobs: **scheme** (light/dark), **density** (comfortable/compact), **radius** (sharp/default/rounded), **brand** (one tenant hex → derived `--brand*`).
- **White-label** — a tenant supplies a brand color (and logo slot); the whole UI re-skins with no component changes, because components reference only role tokens.
- **Token-purity** — the invariant (build-enforced) that component CSS contains **no** hardcoded color/hex/`rgb()`/`hsl()`; only role tokens, numeric primitives, and `color-mix` are allowed.
- **`fos-` class convention** — every component class is BEM-ish and prefixed `fos-` (e.g. `fos-btn`, `fos-kpi`); the theme scope element carries the bare `fos` class.
- **ThemeProvider scope** — the element (`<div class="fos">`) onto which `ThemeProvider` writes `data-theme` / `data-density` / `data-radius` attributes + inline brand vars. Everything inside inherits the cascade.
- **Density-aware control height** — controls size off `--control-h` (38px comfortable / 30px compact: office vs. field use), never a literal height.

## Architecture — the two-tier CSS-variable cascade

```
primitives.css   Tier-1 constants on :root  (--green-600, --space-4, --radius-3 …)
      │  referenced by
      ▼
theme.css        Tier-2 role tokens on :root, remapped under
                 [data-theme="dark"] / [data-density] / [data-radius]
      │  referenced by
      ▼
components.css   .fos-* rules — role tokens + numeric scales ONLY
```

- **theme.css** defines role tokens for light (`:root`) and re-binds them under `[data-theme="dark"]`; density and radius are separate scope blocks that remap `--control-h`/`--gap`/`--card-pad` and `--radius-control`/`--radius-card`.
- **`ThemeProvider`** (`src/theme/ThemeProvider.tsx`) writes the scope attributes and inline brand vars onto its `<div class="fos">`. Theme changes are a **pure CSS-variable cascade — instant, no React re-render**, and **SSR-safe** (attributes can be set server-side → no flash). A **no-React escape hatch** exists: set the same `data-*` attributes and `--brand*` vars by hand and the cascade works identically.
- **`brandVars(hex)`** (`src/theme/brand.ts`) derives `--brand` / `--brand-hover` (darkened) / `--brand-contrast` (luminance-picked text color) from one hex.

See ADR-0001 (two-tier tokens), ADR-0002 (white-label cascade), ADR-0003 (purity gate).

## Conventions

- **Component pattern**: function component (or `forwardRef` where a DOM ref matters); **extends the native element's props**; semantic `variant` / `tone` / `size` props; `className` passthrough merged onto the `fos-*` base class; **controlled-first**.
- **Styling**: 100% token-driven — role tokens + numeric primitives only. **RTL-first logical CSS** (`margin-inline`, `inset-inline-start`); never physical `left`/`right`. Both `dir="rtl"` and `dir="ltr"` supported.
- **States** (as relevant): default / hover / active / `:focus-visible` / disabled / loading / error; visible focus via `--focus-ring`.
- **Sizes**: sm / md (/ lg), density-aware.
- **A11y baseline (publish bar)**: real semantics, ARIA roles/labels, full keyboard paths, focus-trap + `Esc` + return-focus on overlays.
- **Per-component file set**: `Name.tsx` + `Name.stories.tsx` + `Name.test.tsx` + a CSS block in `components.css` + an export line in `src/index.ts`.

## Quality gate (the publish-ready bar)

A component/PR is done only when all pass (see ADR-0003, spec §6):

1. `tokens:present` — required primitives + role tokens exist in both schemes.
2. `tokens:purity` — no hardcoded color in component CSS (wired into `build`).
3. **Types** — strict `tsc --noEmit`, no `any` in public API.
4. **Behavior + a11y** — Vitest + Testing Library + jest-axe (zero violations).
5. **Theme matrix** — key components render across light/dark × comfortable/compact.
6. **Build + Storybook** — `tsup` build and `build-storybook` exit 0.

## Repo map

- `src/components/` — the full v1 catalog (~40 components): forms, data-display, feedback/overlays, navigation/shell, Recharts chart wrappers, and Farm OS domain components.
- `src/theme/` — `ThemeProvider.tsx`, `brand.ts`, `index.ts` barrel; the white-label engine + `useTheme`.
- `src/styles/` — `primitives.css` (Tier-1), `theme.css` (Tier-2 + density/radius), `components.css` (`fos-*` rules), `index.css` (import order).
- `src/index.ts` — public barrel (components + `./theme`); `src/Theming.mdx` — Storybook theming doc.
- `scripts/` — `token-purity.mjs` (lint gate), `check-tokens-present.mjs` (presence check), `bundle-css.mjs` (compiles the single `styles.css`).
- `test/` — harness (`setup.ts`) + cross-cutting tests (theme-matrix, token-purity).
- `docs/superpowers/{specs,plans}/` — the design spec and the phased implementation plans.
- `.storybook/` — `main.ts` + `preview.ts` (theme/density/dir toolbar globals wrapping every story).

## Status

**v1.0 shipped.** All 8 plans in `docs/superpowers/plans/` executed: theming foundation + the full component catalog (forms, data-display, feedback/overlay, navigation/shell, charts, domain) + packaging/CI/publish. Green GitHub Actions CI; 176 tests; Changesets + GitHub Packages publish config (scope `@amrebeid`). Consumed by the Farm OS app at `../../apps/farm-os`.
