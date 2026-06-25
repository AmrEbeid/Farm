import { defineConfig } from "tsup";

export default defineConfig({
  // Two entry points + code splitting so the recharts-based chart components
  // land in their own shared chunk instead of being inlined into the single
  // barrel module. Previously the whole library compiled to one dist/index.js
  // whose top-level `import "recharts"` entered every consumer's bundle the
  // moment ANY component (e.g. Button) was imported — recharts could not be
  // tree-shaken out because it lived in the same module. Splitting isolates the
  // chart code (and recharts) so bundlers drop it from non-chart consumers.
  //
  // Public API is preserved: `@amrebeid/ui` still re-exports the chart
  // components (via src/index.ts -> src/charts.ts), and `@amrebeid/ui/charts`
  // is additionally exposed as a recharts-only subpath.
  entry: { index: "src/index.ts", charts: "src/charts.ts" },
  format: ["esm", "cjs"],
  // Use the typecheck config (react/react-dom type paths) so the d.ts build
  // resolves React types for hoisted deps like recharts. The base tsconfig.json
  // stays paths-free so Storybook/Vite resolve react-dom at runtime correctly.
  tsconfig: "tsconfig.typecheck.json",
  dts: true,
  clean: true,
  // Hoist shared modules into their own chunks (ESM). This is what moves
  // recharts out of the barrel module and into a droppable chunk.
  splitting: true,
  treeshake: true,
  sourcemap: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
