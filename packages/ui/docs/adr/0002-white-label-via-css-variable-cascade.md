# 0002 — White-label via CSS-variable cascade

- **Status:** Accepted — 2026-06-21
- **Context project:** `@amrebeid/ui` theming foundation (spec §3)

## Context

Farm OS is multi-tenant. Each tenant may want its own brand color and a light/dark/density/radius preference, and theme changes (including a runtime toggle) must be cheap and flash-free, including under SSR. We also want the library to stay framework-agnostic — usable outside React — so theming must not be locked behind a React-only API.

## Decision

Apply themes purely through the **CSS-variable cascade**, driven by scope attributes and inline brand vars.

- A small **`ThemeProvider`** (`src/theme/ThemeProvider.tsx`) renders a scope element `<div class="fos">` carrying `data-theme`, `data-density`, `data-radius`, and — when a `brand` hex is given — inline `--brand*` vars. Everything inside inherits the role-token cascade. It also exposes `useTheme()`.
- Brand derivation: **`brandVars(hex)`** (`src/theme/brand.ts`) takes one tenant hex and returns `--brand` (the hex), `--brand-hover` (darkened ~82%), and `--brand-contrast` (white or near-black, chosen by relative luminance).
- **No-React escape hatch:** the provider is sugar. Setting the same `data-*` attributes and `--brand*` custom properties on any element by hand (server-rendered HTML, a plain `<div>`, another framework) produces identical results.
- Because theming is just attribute/variable changes, **switching is instant with no React re-render**, and is **SSR-safe** — render the attributes server-side and there is no theme flash.

## Consequences

- **Positive:** Re-skinning a tenant is one prop (`brand="#…"`) or a few attributes; no component touches. Light/dark/density/radius compose freely. Works in non-React hosts; no hydration flash.
- **Negative / trade-offs:** Correctness depends on the **token-purity invariant** (ADR-0003) — a single hardcoded color in a component silently breaks white-label for that spot, so the gate is load-bearing, not optional. `brandVars` derives `--brand-hover`/`--brand-contrast` heuristically; tenants needing exact secondary shades would need an explicit override path (deferred).
- **Follow-on:** Storybook wraps every story in `ThemeProvider` with toolbar globals for scheme/density/dir so the cascade is exercised continuously.
