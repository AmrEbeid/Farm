import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next (16.2.9) still bundles eslint-plugin-react@^7.37, whose
// version-detection helper calls the `context.getFilename()` API that ESLint 10
// removed (replaced by `context.filename`). With raw ESLint 10 this throws
// "react/display-name: contextOrFilename.getFilename is not a function" before
// any file is linted. No ESLint-10-compatible eslint-plugin-react release exists
// yet (jsx-eslint/eslint-plugin-react#3977, vercel/next.js#89764), so we wrap the
// Next presets with @eslint/compat's fixupConfigRules — the ESLint-team-sanctioned
// shim that backfills the removed context methods for not-yet-migrated plugins.
// It suppresses no lint findings; it only adapts the plugins' rule context.
// Remove once eslint-config-next ships an ESLint-10-compatible eslint-plugin-react.
const eslintConfig = defineConfig([
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
