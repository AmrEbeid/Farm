# 0005 — Charts as thin themed wrappers

- **Status:** Accepted — 2026-06-21
- **Context project:** `@farm-os/ui` catalog (spec §4, §7)

## Context

The v1 catalog needs Bar / Line / Doughnut charts for KPIs and dashboards. Charts are a large, fast-moving domain (axes, scales, legends, tooltips, animation). Building a bespoke charting engine would be a huge, off-mission investment, and — more importantly — a hand-rolled or default-styled chart would not respect dark mode or per-tenant brand, breaking the white-label promise (ADR-0002) precisely where color matters most.

## Decision

Provide **thin themed wrappers around an existing chart library** (Recharts), **not** a charting engine.

- Each chart component wraps the underlying lib and **binds its visual props to Tier-2 role tokens** — series colors derive from `--brand` (and the status/accent role tokens), text from `--ink`/`--ink-muted`, gridlines from `--line`, surfaces from `--surface`. So dark/brand/density themes apply automatically through the same cascade as every other component.
- We do not re-expose the full upstream API surface; wrappers present a small, semantic, token-driven prop set consistent with the rest of the catalog.
- Charts remain **presentational** (ADR-0004): the app supplies data and all labels.

## Consequences

- **Positive:** Charts inherit theming for free and stay visually consistent with the system; we avoid owning chart math. Small surface keeps them maintainable and swappable.
- **Negative / trade-offs:** We inherit the upstream lib's bundle weight and constraints; advanced/exotic chart needs may not be expressible through the thin wrapper and would require widening it deliberately. The exact chart lib was an open question at spec time (Chart.js appears in demos); the plan settles on a single themed wrapper target so the binding-to-role-tokens contract is what matters, not the engine. Token binding must be re-checked whenever the upstream lib changes its styling API.
