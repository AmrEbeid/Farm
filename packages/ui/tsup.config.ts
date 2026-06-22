import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // Use the typecheck config (react/react-dom type paths) so the d.ts build
  // resolves React types for hoisted deps like recharts. The base tsconfig.json
  // stays paths-free so Storybook/Vite resolve react-dom at runtime correctly.
  tsconfig: "tsconfig.typecheck.json",
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
