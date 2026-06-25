# 0005 — Recharts tree-shaken via an `@amrebeid/ui/charts` subpath

- **Status:** Accepted — 2026-06
- **Implementation:**
  - `packages/ui/src/charts.ts` (split entry)
  - `packages/ui/tsup.config.ts` (two entries + `splitting`)
  - `packages/ui/package.json` (`exports["./charts"]`, `recharts` peer dependency)
  - `packages/ui/src/index.ts` (barrel re-export)

## Context

The `@amrebeid/ui` chart components (`BarChart`, `LineChart`, `DoughnutChart`) are built on
recharts, a heavy dependency. The library previously compiled to a single `dist/index.js`
whose top-level `import "recharts"` entered every consumer's bundle the moment **any**
component (e.g. `Button`) was imported. Because recharts lived in the same module as the
rest of the barrel, bundlers could not tree-shake it out — every route paid for recharts
even when it rendered no chart. (See ADR-0005 in `packages/ui/docs/adr/` for the prior
"charts as thin themed wrappers" decision this builds on.)

## Decision

Split the chart code into its own entry and expose it as a dedicated subpath so recharts
only enters a consumer's bundle when a chart is actually imported.

- `src/charts.ts` is a second entry that exports only the chart components and `useChartTokens`.
- `tsup.config.ts` declares two entries (`index`, `charts`) with `splitting: true` and
  `treeshake: true`, so the chart code (and recharts) is hoisted into its own droppable chunk
  instead of being inlined into the barrel module.
- `package.json` `exports` adds `"./charts"` pointing at `dist/charts.{js,cjs,d.ts}`, and
  `recharts` is declared a `peerDependency` (`>=2`) so the host app owns the single copy.
- The main barrel (`src/index.ts`) still re-exports the chart components from `./charts`, so
  `import { BarChart } from "@amrebeid/ui"` keeps working; with code splitting these resolve
  to the separate chunk and tree-shake out of non-chart consumers.

Consumers are advised to prefer `import { BarChart } from "@amrebeid/ui/charts"` to import
charts without touching the barrel at all.

## Consequences

- **Positive:** recharts loads only on chart routes; non-chart pages no longer pay its
  bundle cost. The public API is preserved — both the barrel and the subpath work.
- **Negative / trade-offs:** there are now two import paths for the same components, which
  must stay in sync (the barrel re-export mirrors `charts.ts`). The tree-shaking guarantee
  depends on the consumer's bundler honoring code splitting / `sideEffects` and on importing
  via the barrel not pulling other side-effectful modules; the cleanest result requires the
  subpath import.
