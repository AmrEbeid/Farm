---
"@amrebeid/ui": minor
---

Tree-shake recharts out of the global client bundle — additive, backward-compatible.

The library previously compiled to a single bundled `dist/index.js` whose top-level `import "recharts"` (from the chart components) entered a consumer's bundle the moment **any** component was imported. Because everything lived in one module, recharts (~384 KB) could not be tree-shaken out, so it loaded on every Farm OS route — including `/` and `/login`.

The build now emits two entry points with code splitting (`tsup` `splitting: true`): the recharts-based chart components (`BarChart`, `LineChart`, `DoughnutChart`, `useChartTokens`) are hoisted into their own shared chunk that bundlers drop from consumers that don't reference a chart.

- Public API unchanged: `import { BarChart } from "@amrebeid/ui"` still works (the barrel re-exports the chart components).
- New additive subpath: `import { BarChart } from "@amrebeid/ui/charts"` imports charts without touching the main barrel. Preferred for app code so recharts only enters chart routes.
- `sideEffects` remains accurate (only `*.css`).

Measured in the Farm OS app build: recharts went from the shared chunk on **18/18** routes (376 KB each) to only the **2** routes that render a chart; non-chart routes (`/`, `/login`, `/_not-found`, …) dropped ~376 KB of First Load JS.
