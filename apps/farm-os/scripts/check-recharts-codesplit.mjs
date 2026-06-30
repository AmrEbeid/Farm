#!/usr/bin/env node
/*
 * CI guard: keep Recharts code-split off the global / non-chart bundles.
 *
 * Background
 * ----------
 * Recharts is heavy. Only two routes render a chart — /inventory/[itemId]/coverage
 * and /reports/[planId]/pva — and they pull it in via the client-only wrapper
 * apps/farm-os/components/charts.tsx (import "@amrebeid/ui/charts"). A code-split
 * win removed Recharts from the other 16/18 routes and from the always-loaded
 * shared/framework chunk. This script asserts that win still holds so a future
 * change (e.g. importing a chart from a layout, or adding it to the wrong import
 * barrel) cannot silently re-bloat every route.
 *
 * What it checks
 * --------------
 * 1. Sanity: Recharts IS present somewhere in the client build. If it isn't, the
 *    scan is meaningless (recharts removed, renamed, or output layout changed) and
 *    we fail loudly rather than pass by accident.
 * 2. Guard: every client chunk that contains "recharts" is referenced ONLY by the
 *    allow-listed chart routes' per-route client-reference manifests, and never by
 *    the always-loaded shared chunks (build-manifest rootMainFiles).
 *
 * Robustness
 * ----------
 * - Hash-agnostic: the recharts chunk(s) are discovered by scanning file CONTENT,
 *   then matched in route manifests by bare basename — chunk-hash filename churn is
 *   irrelevant.
 * - Self-checking: if the .next layout or manifests Next emits ever move, the
 *   sanity assertion (or the "no manifests found" guard) fails instead of silently
 *   passing.
 *
 * Run from apps/farm-os (CI does `cd apps/farm-os && node scripts/check-recharts-codesplit.mjs`).
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const NEXT_DIR = ".next";
const CLIENT_CHUNKS_DIR = join(NEXT_DIR, "static", "chunks");
const APP_SERVER_DIR = join(NEXT_DIR, "server", "app");
const BUILD_MANIFEST = join(NEXT_DIR, "build-manifest.json");
const NEEDLE = "recharts";

// Routes that are allowed to ship Recharts in their own bundle. Keyed by the
// route path Next uses inside the RSC manifest (route group "(app)" is stripped).
const ALLOWED_CHART_ROUTES = [
  "/inventory/[itemId]/coverage/page",
  "/reports/[planId]/pva/page",
  // The strategic owner home (لوحة معلومات المالك) intentionally renders charts; recharts
  // stays in this route's own client chunk (loaded only here), never the global bundle.
  "/dashboard/owner/page",
  // The finance dashboard renders budget-utilisation + variance charts; same code-split
  // guarantee — recharts lives in this route's own client chunk, never the global bundle.
  "/finance/dashboard/page",
  // Module dashboards each render their own charts (status/type doughnuts, grouped
  // bars, the weather temperature trend). Same guarantee — recharts stays confined to
  // each route's own client chunk, never the global/shared bundle.
  "/plans/dashboard/page",
  "/inventory/dashboard/page",
  "/farm/dashboard/page",
  "/people/dashboard/page",
  "/weather/dashboard/page",
  // The settings dashboard renders a role-distribution doughnut; same guarantee.
  "/settings/dashboard/page",
];

function die(msg) {
  console.error(`\n❌ recharts code-split guard FAILED\n\n${msg}\n`);
  process.exit(1);
}

if (!existsSync(NEXT_DIR)) {
  die(`No ${NEXT_DIR} directory — run \`next build\` before this guard.`);
}

// --- Collect all client JS chunks (recursively) ---------------------------
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".js")) out.push(p);
  }
  return out;
}

if (!existsSync(CLIENT_CHUNKS_DIR)) {
  die(`No client chunks at ${CLIENT_CHUNKS_DIR} — build output layout changed?`);
}
const allClientChunks = walk(CLIENT_CHUNKS_DIR);

// --- (1) Find which client chunks actually contain Recharts ----------------
const rechartsChunks = allClientChunks.filter((p) =>
  readFileSync(p, "utf8").includes(NEEDLE),
);
// Bare basenames, used to match references inside route manifests.
const rechartsBasenames = rechartsChunks.map((p) => p.split("/").pop());

if (rechartsChunks.length === 0) {
  die(
    `Sanity check failed: no client chunk contains "${NEEDLE}".\n` +
      `Recharts should still be in the chart-route bundles. Either Recharts was\n` +
      `removed/renamed or the build output layout changed — update this guard.`,
  );
}
console.log(
  `Found Recharts in ${rechartsChunks.length} client chunk(s): ${rechartsBasenames.join(", ")}`,
);

// --- (2a) It must NOT be in the always-loaded shared chunks -----------------
if (existsSync(BUILD_MANIFEST)) {
  const manifest = JSON.parse(readFileSync(BUILD_MANIFEST, "utf8"));
  const shared = manifest.rootMainFiles || [];
  const offenders = shared.filter((f) =>
    rechartsBasenames.some((b) => f.endsWith(b)),
  );
  if (offenders.length) {
    die(
      `Recharts is in the GLOBAL shared bundle (build-manifest rootMainFiles):\n` +
        offenders.map((f) => `  - ${f}`).join("\n") +
        `\n\nThat means EVERY route now downloads Recharts. Keep chart imports behind\n` +
        `the client-only wrapper (components/charts.tsx → "@amrebeid/ui/charts") and\n` +
        `out of layouts / shared modules.`,
    );
  }
}

// --- (2b) Only the allow-listed chart routes may reference it ---------------
if (!existsSync(APP_SERVER_DIR)) {
  die(`No ${APP_SERVER_DIR} — App Router server output missing?`);
}

const manifestFiles = walk(APP_SERVER_DIR).filter((p) =>
  p.endsWith("page_client-reference-manifest.js"),
);
if (manifestFiles.length === 0) {
  die(
    `No page_client-reference-manifest.js files found under ${APP_SERVER_DIR}.\n` +
      `App Router manifest layout changed — update this guard.`,
  );
}

// route key for a manifest path: strip dir prefix, route group "(app)", suffix.
function routeKey(manifestPath) {
  return (
    "/" +
    manifestPath
      .slice(APP_SERVER_DIR.length + 1)
      .replace(/\/page_client-reference-manifest\.js$/, "/page")
      .replace(/\(app\)\//g, "")
  );
}

const offendingRoutes = [];
for (const mf of manifestFiles) {
  const route = routeKey(mf);
  if (ALLOWED_CHART_ROUTES.includes(route)) continue;
  const body = readFileSync(mf, "utf8");
  if (rechartsBasenames.some((b) => body.includes(b))) {
    offendingRoutes.push(route);
  }
}

if (offendingRoutes.length) {
  die(
    `These non-chart routes now pull in the Recharts chunk:\n` +
      offendingRoutes.map((r) => `  - ${r}`).join("\n") +
      `\n\nRecharts must stay confined to the chart routes:\n` +
      ALLOWED_CHART_ROUTES.map((r) => `  - ${r}`).join("\n") +
      `\n\nIf you intentionally added a chart to a new route, add it to\n` +
      `ALLOWED_CHART_ROUTES in apps/farm-os/scripts/check-recharts-codesplit.mjs.`,
  );
}

console.log(
  `✅ Recharts is confined to the ${ALLOWED_CHART_ROUTES.length} chart route(s); ` +
    `it is absent from the global/shared bundle and all ${manifestFiles.length - ALLOWED_CHART_ROUTES.length} other routes.`,
);
