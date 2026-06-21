# 0001 — Two-tier token system (primitives vs. role tokens)

- **Status:** Accepted — 2026-06-21
- **Context project:** `@farm-os/ui` theming foundation (spec §3)

## Context

Farm OS must support full white-label theming — light/dark, per-tenant brand color, density, and radius — across a growing component catalog. If components reference raw color/size constants directly, every theme dimension multiplies the edit surface and re-skinning a tenant means touching component CSS. We need a layer of indirection so the *meaning* of a value (a surface, ink, the brand) is separated from its *concrete value* (a hex, a px).

## Decision

Use **two tiers of CSS custom properties**, with a strict consumption rule.

- **Tier 1 — Primitives** (`src/styles/primitives.css`): theme-agnostic constants. Color ramps (`--green-50…900`, `--gold-*`, neutral `--gray-0…900`, status hues `--red/amber/blue/purple-{100,500,700}`) and numeric scales (`--space-1…10`, `--radius-0…3`/`--radius-pill`, `--text-xs…3xl`, weights, `--shadow-1…3`, `--z-*`, `--dur-*`, `--ease`, font family). Primitives never change per theme.
- **Tier 2 — Role tokens** (`src/styles/theme.css`): semantic variables that *map onto* primitives and **flip per theme** — `--brand`/`--brand-hover`/`--brand-contrast`, `--surface`/`--surface-raised`/`--surface-sunken`, `--ink`/`--ink-muted`, `--line`, `--focus-ring`, status pairs `--{success,warning,danger,info}-{bg,fg}` (plus `--neutral-*`/`--accent-*`), and density/radius outputs (`--control-h`, `--gap`, `--card-pad`, `--radius-control`, `--radius-card`).

**Components reference only Tier-2 role tokens and numeric primitives — never Tier-1 color ramps directly.** Import order is fixed: `primitives.css → theme.css → components.css`.

## Consequences

- **Positive:** A theme dimension is added by remapping role tokens in one place, not editing components. The ramps stay a stable, named palette. The rule is mechanically checkable, which is what makes the purity gate (ADR-0003) and white-label (ADR-0002) possible.
- **Negative / trade-offs:** Two layers of indirection add a small cognitive hop ("which role token, backed by which ramp?"). New status/role colors require adding a role token rather than reaching for a ramp inline — intentional friction, enforced by the gate.
- **Follow-on:** `check-tokens-present.mjs` asserts the required primitives and role tokens exist (role tokens in both light and dark).
