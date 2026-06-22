# Architecture Decision Records

Decisions behind `@amrebeid/ui`, grounded in `docs/superpowers/specs/2026-06-21-farm-os-ui-publish-ready-design.md`. See `../../CONTEXT.md` for the domain/architecture overview.

- [0001 — Two-tier token system](0001-two-tier-token-system.md) — primitives vs. role tokens; components reference only role tokens.
- [0002 — White-label via CSS-variable cascade](0002-white-label-via-css-variable-cascade.md) — `ThemeProvider` scope attrs + inline brand vars; no-React escape hatch; SSR-safe; instant flip.
- [0003 — Token-purity build gate](0003-token-purity-build-gate.md) — lint forbids hardcoded color in component CSS; only role tokens / numeric primitives / `color-mix` allowed.
- [0004 — RTL-first logical CSS](0004-rtl-first-logical-css.md) — logical properties only, Arabic-first; presentational-only / no-i18n boundary.
- [0005 — Charts as thin themed wrappers](0005-charts-as-thin-themed-wrappers.md) — wrap Recharts and bind to role tokens; not a charting engine.
- [0006 — Changesets + private-first publish](0006-changesets-private-first-publish.md) — Changesets versioning, stay 0.x → 1.0, private registry first, public-capable.
