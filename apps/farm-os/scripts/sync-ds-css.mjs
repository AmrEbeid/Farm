// Syncs the design-system bundled CSS from @amrebeid/ui into the app.
//
// The app imports an app-local copy of the library CSS (app/farm-os-ui.css)
// because importing global CSS from a node_modules/workspace path breaks the
// Vercel build. This script keeps that copy in lockstep with the built library
// CSS so merged design-system changes (e.g. DataTable reflow, tap-targets,
// reduced-motion) actually reach the app. It runs automatically via the
// `prebuild`/`predev` npm scripts.
//
// Do NOT hand-edit app/farm-os-ui.css — it is overwritten by this script.

import { copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const src = resolve(appDir, "../../packages/ui/dist/styles.css");
const dest = resolve(appDir, "app/farm-os-ui.css");

const header =
  "/* AUTO-SYNCED from @amrebeid/ui (packages/ui/dist/styles.css) by scripts/sync-ds-css.mjs. */\n" +
  "/* Do NOT hand-edit — run `npm run sync:ds-css` (or any build/dev) to regenerate. */\n";

if (!existsSync(src)) {
  // The library CSS is a build artifact; if it's missing, keep the existing
  // committed copy rather than failing the app build.
  console.warn(`[sync-ds-css] source not found: ${src} — keeping existing ${dest}`);
  process.exit(0);
}

copyFileSync(src, dest);
const copied = readFileSync(dest, "utf8");
writeFileSync(dest, header + copied);
console.log(`[sync-ds-css] synced ${src} -> ${dest}`);
