# 0004 — RTL-first logical CSS, presentational-only boundary

- **Status:** Accepted — 2026-06-21
- **Context project:** `@amrebeid/ui` catalog conventions (spec §4 boundaries)

## Context

Farm OS serves Arabic-speaking farms in Egypt/MENA; **Arabic RTL is the primary reading direction**, with LTR also supported. Physical CSS (`left`/`right`, `margin-left`) breaks under RTL and forces per-direction overrides. Separately, the library will be consumed by an app that owns translation; if components embedded their own copy or i18n, they would couple to a locale and duplicate the app's responsibility.

## Decision

- **RTL-first, logical CSS only.** Components use logical properties — `margin-inline`, `padding-inline`, `inset-inline-start`, `border-inline-*`, `text-align: start/end` — and **never** physical `left`/`right`. Direction is driven by the `dir` attribute (`rtl` default, `ltr` supported); the same CSS flips automatically.
- **Presentational only — no strings, no i18n inside the library.** Components accept all user-facing text as props/children. There is no translation layer, no locale state, no hardcoded labels in components. The consuming app (Farm OS) owns all copy and translation.

## Consequences

- **Positive:** A single stylesheet serves both directions with no `[dir]` overrides; Arabic is correct by default rather than retrofitted. The library stays locale-agnostic and reusable; the app's translation strategy can evolve without library releases. Storybook carries a `dir` toolbar global to exercise both directions.
- **Negative / trade-offs:** Contributors must internalize logical-property names (easy to slip into `left`/`right` from muscle memory) — caught in review and reinforced by RTL Storybook snapshots. Consumers must remember to set `dir` and pass every string; the library cannot supply sensible default labels. Older browser support for logical properties is assumed adequate for the target (modern evergreen) environment.
