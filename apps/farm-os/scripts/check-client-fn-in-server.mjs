#!/usr/bin/env node
/*
 * CI guard: never call a "use client"-exported FUNCTION from a Server Component.
 *
 * Background
 * ----------
 * `@amrebeid/ui` exports a few plain helper FUNCTIONS from its "use client" Tabs
 * module — `tabId(id)` and `tabPanelId(id)` (they return `fos-tab-${id}` /
 * `fos-tabpanel-${id}`). Because they live in a "use client" module they are
 * CLIENT functions. A React Server Component may RENDER a client component or
 * PASS it as a prop, but it may NOT call a client function directly. Doing so
 * (e.g. `id={tabPanelId("overview")}` in a server page) throws at request-time:
 *
 *   Error: Attempted to call tabPanelId() from the server but tabPanelId is on
 *   the client.
 *
 * This is invisible to `next build`, `tsc`, ESLint and the recharts guard — it
 * is a runtime RSC violation, not a static one. In 2026-06 it shipped green-CI
 * and 500'd every tabbed 360 page in production. The fix was a server-safe
 * mirror module, `@/lib/tab-ids`, with byte-identical helpers.
 *
 * What it checks
 * --------------
 * In every Server Component under app/ and components/ (a .ts/.tsx file WITHOUT
 * a top-of-file "use client" directive), this guard fails if the file imports one
 * of the known client-only helper functions from a CLIENT barrel
 * (`@/components/ui` or `@amrebeid/ui`) instead of the server-safe `@/lib/tab-ids`.
 *
 * Extending
 * ---------
 * If a new lowercase helper FUNCTION (not a component) is added to a "use client"
 * module and re-exported through a barrel, add its name to CLIENT_ONLY_FUNCTIONS
 * and provide a server-safe replacement module. Components (PascalCase) are fine
 * to import into a server file — they are rendered, not called — so they are NOT
 * listed here.
 *
 * Pure Node, no build needed. Run from apps/farm-os.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Client-only helper FUNCTIONS that must never be imported into a Server
// Component from a client barrel. Map: name -> server-safe replacement to suggest.
const CLIENT_ONLY_FUNCTIONS = {
  tabId: "@/lib/tab-ids",
  tabPanelId: "@/lib/tab-ids",
};

// Barrels that re-export the CLIENT version of the above helpers.
const CLIENT_SOURCES = new Set(["@/components/ui", "@amrebeid/ui"]);

const SCAN_DIRS = ["app", "components"];
const NAMES = Object.keys(CLIENT_ONLY_FUNCTIONS);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|stories)\./.test(name)) out.push(p);
  }
  return out;
}

/** True if the file opts into the client with a top-of-file "use client". */
function isClientComponent(src) {
  // Directive must be the first statement (ignoring comments/blank lines).
  const head = src.replace(/^﻿/, "").slice(0, 400);
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head);
}

const violations = [];

for (const root of SCAN_DIRS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    if (isClientComponent(src)) continue; // client file — allowed

    // Match: import { ...names... } from "<source>"
    const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const source = m[2];
      if (!CLIENT_SOURCES.has(source)) continue;
      const imported = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
      for (const name of NAMES) {
        if (imported.includes(name)) {
          violations.push({ file, name, source, replacement: CLIENT_ONLY_FUNCTIONS[name] });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("\n❌ client-function-in-server guard FAILED\n");
  console.error(
    "A Server Component imports a \"use client\"-only helper function from a client\n" +
      "barrel. Calling it at render throws \"Attempted to call <fn>() from the server\".\n" +
      "Import the server-safe mirror instead:\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    imports ${v.name} from "${v.source}" — use "${v.replacement}" instead\n`);
  }
  process.exit(1);
}

console.log(
  `✅ client-function-in-server guard: no Server Component imports ${NAMES.map((n) => `${n}()`).join(
    " / ",
  )} from a client barrel.`,
);
