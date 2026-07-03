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
  {
    // Number-formatting discipline (project non-negotiable #1: no Western-digit leaks). `.toFixed()`
    // ALWAYS renders ASCII 0-9 with a `.` separator — a Western-digit leak wherever its output reaches
    // the UI — and there is no ar-EG variant of it. All user-facing numbers must go through
    // `num`/`pct`/`egpValue` in `lib/money` (Intl `ar-EG-u-nu-arab`, tabular). Zero `.toFixed()` uses
    // exist today, so this is a pure regression guard, not a migration. (`toLocaleString` is NOT banned
    // here: `lib/relative-schedule.ts` uses `toLocaleString("ar-EG")` correctly; a stricter
    // locale-aware rule that allows only the ar-EG form is a possible follow-up.)
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "toFixed",
          message:
            "toFixed() leaks Western digits — use num()/pct()/egpValue() from lib/money (ar-EG Arabic-Indic). Non-negotiable #1.",
        },
      ],
    },
  },
]);

export default eslintConfig;
