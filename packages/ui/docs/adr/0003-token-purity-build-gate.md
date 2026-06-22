# 0003 — Token-purity build gate

- **Status:** Accepted — 2026-06-21
- **Context project:** `@amrebeid/ui` theming foundation (spec §3, §6)

## Context

White-label theming (ADR-0002) only holds if components reference role tokens and never bake in concrete colors. This is a convention humans (and AI agents) will violate by habit — a stray `#fff`, an `rgb(...)` copied from a mockup. A convention that isn't enforced will rot, and a single hardcoded color silently defeats dark mode and tenant brand for that element. We need an objective, build-blocking oracle.

## Decision

Add a **token-purity lint** (`scripts/token-purity.mjs`) that scans component CSS and **exits non-zero on any hardcoded color** — hex (`#[0-9a-fA-F]{3,8}`) or color functions (`rgb`/`rgba`/`hsl`/`hsla`). Comments are stripped before matching, and it reports `file:line` for each offender.

- **Allowed in component CSS:** Tier-2 role tokens (`var(--brand)`, `var(--surface)`, `var(--success-fg)` …), numeric primitives (`var(--space-4)`, `var(--radius-control)`, `var(--control-h)` …), and `color-mix(...)` over role tokens for derived shades.
- **The only files allowed raw color values** are the token-definition files `primitives.css` (Tier-1 hexes) and `theme.css` (the per-theme role-token mappings).
- It is **wired into `build`** (`"build": "npm run tokens:purity && tsup && npm run build:css"`) so a violation fails CI and blocks merge. It is also exercised by `test/token-purity.test.ts`.

## Consequences

- **Positive:** White-label correctness becomes a guarantee, not a code-review hope. The gate is fast, dependency-free (plain Node), and gives precise feedback. AI agents adding components get an immediate, unambiguous failure when they hardcode a color.
- **Negative / trade-offs:** The check is regex-based, so it is intentionally strict and slightly blunt — a legitimately raw value in component CSS must instead be promoted to a new role token in `theme.css` (e.g. gradient stops). The script must not be weakened to pass; the fix is always a new role token. It catches color, not every conceivable theming leak (e.g. a magic px height instead of `--control-h`), which remains a review concern.
