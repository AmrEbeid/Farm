#!/usr/bin/env node
/*
 * CI guard: the Supabase service-role secret never reaches a repository artefact,
 * a client module graph, or the built client bundle.  (Payroll access review L-8.)
 *
 * Background
 * ----------
 * `lib/supabase/admin.ts` holds the RLS-bypassing service-role client. It is
 * protected by `import "server-only"` (build-time) plus a `typeof window` throw
 * (runtime), and the key is read from `SUPABASE_SERVICE_ROLE_KEY` — deliberately
 * WITHOUT a `NEXT_PUBLIC_` prefix, so Next never inlines it into client output.
 * `docs/payroll privacy access review.md` §9.2 records the dated production
 * snapshot evidence for live check L-8.
 *
 * Nothing in the repo proved it before this guard:
 *   - gitleaks (ci.yml `secret-scan`) scans COMMITTED HISTORY and its config
 *     (`.gitleaks.toml`) explicitly ALLOWLISTS `.next/` — so by construction it
 *     cannot see the client bundle, which is the exact artefact L-8 is about.
 *   - `server-only` fails a build on a *static* client import, but says nothing
 *     about repo artefacts, about the emitted bundle, or about a key pasted into
 *     a doc/fixture/workflow file.
 *   - No test asserted the env-name shape that would cause the inlining
 *     (`NEXT_PUBLIC_…SERVICE_ROLE…`).
 *
 * What it checks (four arms, all mandatory)
 * -----------------------------------------
 *   A. Repository artefacts — every git-tracked file in the monorepo carries no
 *      Supabase secret VALUE and no client-inlining env NAME.
 *   B. Client module graph — no `"use client"` module reaches a server-only
 *      module (the admin client and its dependants) through static imports, and
 *      no client module names the server-only env var. `"use server"` modules are
 *      a legitimate boundary (Next ships a reference stub, not the module), so
 *      the walk stops there — `components/site/SiteLanding.tsx` →
 *      `app/enquiry-actions.ts` → `lib/supabase/admin.ts` is that live case.
 *   C. Built client bundle — nothing under `.next/static` (what the browser
 *      actually downloads) carries a secret value or the server-only env name.
 *   D. Detector self-tests — every detector is fired against synthetic in-memory
 *      fixtures and against benign text, so a detector that silently stopped
 *      matching fails the guard instead of passing it empty.
 *
 * Non-vacuity
 * -----------
 * A scan that finds nothing is worthless unless it is proven to have looked.
 * Every arm carries a floor and fails below it: file/byte counts for A and C,
 * a client-entry-module count and two POSITIVE CONTROLS for B — the walker must
 * reach `lib/supabase/admin.ts` from a known server importer, and must reach it
 * from `SiteLanding.tsx` when the `"use server"` boundary rule is disabled. If
 * module resolution breaks, those controls fail rather than the guard passing.
 *
 * Secret hygiene
 * --------------
 * This guard never reads `.env*.local` (untracked, so arm A never sees it), never
 * prints a matched value, and never logs decoded JWT content. A finding is
 * reported as detector id + file path + byte offset only. Its own fixtures are
 * assembled at runtime from fragments so no secret-shaped literal is committed.
 *
 * The default CI run does not fetch the DEPLOYED bundle. Arms A-C prove the
 * source, graph and LOCAL build output on every change. Point this script at a
 * directory of downloaded deployed chunks with `--bundle-dir <path>` to repeat
 * the dated production-snapshot arm recorded in the review packet.
 *
 * Usage:  cd apps/farm-os && node scripts/check-service-role-exposure.mjs
 *         [--bundle-dir <dir>]   also scan a directory of deployed chunks
 */
import { readFileSync, readlinkSync, readdirSync, existsSync, lstatSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = execFileSync("git", ["-C", APP_DIR, "rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

// ---------------------------------------------------------------------------
// Detectors. Each returns byte offsets of matches — never the matched text.
// ---------------------------------------------------------------------------

/**
 * A Supabase-issued JWT whose payload claims a role other than `anon`.
 * The publishable anon key legitimately ships to the browser; a `service_role`
 * (or any other elevated role) key never may. Matching is structural: find the
 * JWT triple, base64url-decode the PAYLOAD ONLY, and test the `role` claim. The
 * decoded content is discarded immediately and never logged.
 */
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
function detectElevatedJwt(text) {
  const hits = [];
  JWT_RE.lastIndex = 0;
  let m;
  while ((m = JWT_RE.exec(text)) !== null) {
    let role;
    try {
      role = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")).role;
    } catch {
      continue; // not a JSON payload — not a Supabase key
    }
    if (typeof role === "string" && role !== "anon") hits.push(m.index);
  }
  return hits;
}

/** A Supabase API secret key in the current (`sb_secret_…`) format. */
const SECRET_KEY_RE = /\bsb_secret_[A-Za-z0-9_-]{20,}/g;

/**
 * An env NAME that would make Next inline a server secret into client output.
 * Next replaces `process.env.NEXT_PUBLIC_*` at build time, so a service-role key
 * behind such a name is published to every visitor. The correct name — the one
 * `lib/supabase/admin.ts` uses — has no `NEXT_PUBLIC_` prefix.
 */
const PUBLIC_SECRET_ENV_RE =
  /\bNEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SERVICE_KEY|SECRET_KEY|SECRET)[A-Z0-9_]*/g;

/**
 * The server-only env name appearing in CLIENT output. Next never inlines a
 * non-`NEXT_PUBLIC_` variable, so its presence in a browser chunk means a
 * server-only module was bundled for the client — the leak path itself, even if
 * the value resolved to `undefined` in this particular build.
 */
const SERVER_ENV_NAME_RE = /\bSUPABASE_SERVICE_ROLE_KEY\b/g;

function offsets(re, text) {
  const hits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) hits.push(m.index);
  return hits;
}

const DETECTORS = {
  "elevated-supabase-jwt": {
    describe: "a Supabase JWT whose payload claims a role other than `anon`",
    run: detectElevatedJwt,
  },
  "supabase-secret-key": {
    describe: "a Supabase `sb_secret_…` API secret key",
    run: (text) => offsets(SECRET_KEY_RE, text),
  },
  "public-secret-env-name": {
    describe: "a NEXT_PUBLIC_ env name that would inline a server secret into the client bundle",
    run: (text) => offsets(PUBLIC_SECRET_ENV_RE, text),
  },
  "server-env-name-in-client-output": {
    describe: "the server-only SUPABASE_SERVICE_ROLE_KEY name inside client output",
    run: (text) => offsets(SERVER_ENV_NAME_RE, text),
  },
};

const VALUE_DETECTORS = ["elevated-supabase-jwt", "supabase-secret-key"];
const REPO_DETECTORS = [...VALUE_DETECTORS, "public-secret-env-name"];
const BUNDLE_DETECTORS = [...REPO_DETECTORS, "server-env-name-in-client-output"];

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const findings = [];
const vacuity = [];

function report(arm, detector, file, offset) {
  findings.push({ arm, detector, file, offset });
}
function floor(arm, label, actual, minimum) {
  if (actual < minimum) {
    vacuity.push(`${arm}: ${label} = ${actual}, below the floor of ${minimum} — the scan did not look at enough to mean anything.`);
  }
  return actual;
}

/** Read as latin1: byte-faithful for the ASCII shapes every detector matches. */
function readText(path) {
  return readFileSync(path).toString("latin1");
}

function scan(arm, detectorIds, file, text) {
  for (const id of detectorIds) {
    for (const offset of DETECTORS[id].run(text)) report(arm, id, file, offset);
  }
}

function walkFiles(dir, keep = () => true) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const stat = lstatSync(p);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) out.push(...walkFiles(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arm D — detector self-tests (run FIRST: a broken detector invalidates A–C)
// ---------------------------------------------------------------------------
// Fixtures are assembled from fragments at runtime so this file itself contains
// no secret-shaped literal (which arm A would otherwise flag, correctly).

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
const FAKE_HEADER = b64url({ alg: "HS256", typ: "JWT" });
const FAKE_SIG = "0".repeat(43);
const fakeJwt = (role) => `${FAKE_HEADER}.${b64url({ iss: "supabase", role })}.${FAKE_SIG}`;

const SELF_TESTS = [
  {
    detector: "elevated-supabase-jwt",
    positive: `const k = "${fakeJwt("service_role")}";`,
    negative: `const k = "${fakeJwt("anon")}";`,
  },
  {
    detector: "supabase-secret-key",
    positive: "SUPABASE_KEY=" + "sb_" + "secret_" + "A".repeat(32),
    negative: "SUPABASE_KEY=" + "sb_" + "publishable_" + "A".repeat(32),
  },
  {
    detector: "public-secret-env-name",
    positive: "process.env." + "NEXT_PUBLIC_" + "SUPABASE_SERVICE_ROLE_KEY",
    negative: "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY",
  },
  {
    detector: "server-env-name-in-client-output",
    positive: "process.env." + "SUPABASE_SERVICE" + "_ROLE_KEY",
    negative: "process.env.SUPABASE_URL",
  },
];

const selfTestFailures = [];
for (const t of SELF_TESTS) {
  const d = DETECTORS[t.detector];
  if (d.run(t.positive).length === 0) {
    selfTestFailures.push(`${t.detector}: did NOT match its positive fixture — the detector is dead, so every clean result from it is vacuous.`);
  }
  if (d.run(t.negative).length !== 0) {
    selfTestFailures.push(`${t.detector}: matched its benign fixture — it would flag legitimate code.`);
  }
}

// ---------------------------------------------------------------------------
// Arm A — repository artefacts (every git-tracked file in the monorepo)
// ---------------------------------------------------------------------------
// `git ls-files` excludes gitignored trees (node_modules/, .next/, dist/) and
// every untracked file — so `.env.local` and any real key on this machine are
// never opened. Binaries are scanned too (a key can hide in a workbook); the
// detectors are structural enough not to false-positive on binary noise.

const trackedFiles = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

let repoBytes = 0;
let repoScanned = 0;
for (const rel of trackedFiles) {
  const abs = join(REPO_ROOT, rel);
  let text;
  try {
    text = lstatSync(abs).isSymbolicLink() ? readlinkSync(abs) : readText(abs);
  } catch {
    continue; // deleted-but-staged, symlink to nowhere, unreadable — not a leak path
  }
  repoBytes += text.length;
  repoScanned += 1;
  scan("A · repository artefacts", REPO_DETECTORS, rel, text);
}
floor("A · repository artefacts", "tracked files scanned", repoScanned, 900);
floor("A · repository artefacts", "bytes scanned", repoBytes, 2_000_000);

// ---------------------------------------------------------------------------
// Arm B — client module graph
// ---------------------------------------------------------------------------

const SOURCE_ROOTS = ["app", "components", "lib"];
const SOURCE_EXT = [".ts", ".tsx", ".mts", ".js", ".jsx"];

const sourceFiles = SOURCE_ROOTS.flatMap((r) =>
  walkFiles(join(APP_DIR, r), (p) => SOURCE_EXT.some((e) => p.endsWith(e))),
).map((p) => relative(APP_DIR, p));

const srcCache = new Map();
function sourceOf(rel) {
  if (!srcCache.has(rel)) {
    try {
      srcCache.set(rel, readText(join(APP_DIR, rel)));
    } catch {
      srcCache.set(rel, null);
    }
  }
  return srcCache.get(rel);
}

/** A top-of-file directive, ignoring a leading BOM, comments and blank lines. */
function directive(rel, name) {
  const src = sourceOf(rel);
  if (src === null) return false;
  const head = src.replace(/^﻿/, "").slice(0, 600);
  return new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${name}["']`).test(head);
}
const isClientModule = (rel) => directive(rel, "use client");
const isServerActionModule = (rel) => directive(rel, "use server");

const IMPORT_RE =
  /(?:^|[\s;}])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

const knownSources = new Set(sourceFiles);
const SERVICE_ROLE_READER_RE =
  /process\.env(?:\.SUPABASE_SERVICE_ROLE_KEY|\[\s*["']SUPABASE_SERVICE_ROLE_KEY["']\s*\])/;

/** Modules that directly read the service-role env var and must never reach a client graph. */
const SERVER_ONLY_MODULES = sourceFiles.filter((rel) =>
  SERVICE_ROLE_READER_RE.test(sourceOf(rel) ?? ""),
);

for (const rel of SERVER_ONLY_MODULES) {
  if (!/^\s*import\s*["']server-only["'];?/m.test(sourceOf(rel) ?? "")) {
    findings.push({
      arm: "B · client module graph",
      detector: "service-role-reader-missing-server-only",
      file: rel,
      offset: null,
      detail: "directly reads SUPABASE_SERVICE_ROLE_KEY without importing the server-only boundary",
    });
  }
}

/** Resolve a local specifier (`@/…` or relative) to a repo-relative source file. */
function resolveLocal(fromRel, spec) {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = relative(APP_DIR, resolve(APP_DIR, dirname(fromRel), spec));
  else return null; // bare package specifier — not our graph
  const candidates = [
    base,
    ...SOURCE_EXT.map((e) => base + e),
    ...SOURCE_EXT.map((e) => `${base}/index${e}`),
    // `allowImportingTsExtensions` lets a specifier carry .js for a .ts file.
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
  ];
  return candidates.find((c) => knownSources.has(c)) ?? null;
}

function importsOf(rel) {
  const src = sourceOf(rel);
  if (src === null) return [];
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    const target = resolveLocal(rel, spec);
    if (target) out.push(target);
  }
  return out;
}

let resolvedEdges = 0;

/**
 * Walk static imports from `entry`. With `respectServerBoundary`, stop at any
 * `"use server"` module: Next replaces such an import with a network reference
 * in the client bundle, so its module graph is NOT shipped to the browser.
 * Returns the map of reached server-only module -> the path that reached it.
 */
function reachServerOnly(entry, { respectServerBoundary = true } = {}) {
  const seen = new Set([entry]);
  const queue = [[entry, [entry]]];
  const reached = new Map();
  while (queue.length) {
    const [rel, path] = queue.shift();
    for (const next of importsOf(rel)) {
      resolvedEdges += 1;
      if (SERVER_ONLY_MODULES.includes(next) && !reached.has(next)) {
        reached.set(next, [...path, next]);
      }
      if (seen.has(next)) continue;
      if (respectServerBoundary && isServerActionModule(next)) continue; // boundary
      seen.add(next);
      queue.push([next, [...path, next]]);
    }
  }
  return reached;
}

const clientEntries = sourceFiles.filter(isClientModule);
for (const entry of clientEntries) {
  for (const [target, path] of reachServerOnly(entry)) {
    findings.push({
      arm: "B · client module graph",
      detector: "server-only-module-reachable-from-client",
      file: entry,
      offset: null,
      detail: `reaches ${target} via ${path.join(" → ")}`,
    });
  }
  // A client module must not even NAME the server-only variable.
  const src = sourceOf(entry);
  if (src !== null) {
    scan("B · client module graph", ["server-env-name-in-client-output", "public-secret-env-name"], entry, src);
  }
}

floor("B · client module graph", '"use client" entry modules found', clientEntries.length, 50);
floor("B · client module graph", "local import edges resolved", resolvedEdges, 300);
floor("B · client module graph", "source files discovered", sourceFiles.length, 300);
floor("B · client module graph", "service-role env readers discovered", SERVER_ONLY_MODULES.length, 2);

// Positive control 1 — a KNOWN server importer must reach the admin client.
// If module resolution breaks, this fails instead of arm B passing empty.
const CONTROL_SERVER_IMPORTER = "app/enquiry-actions.ts";
if (!reachServerOnly(CONTROL_SERVER_IMPORTER, { respectServerBoundary: false }).has("lib/supabase/admin.ts")) {
  vacuity.push(
    `B · client module graph: positive control failed — the walker did not reach lib/supabase/admin.ts from ${CONTROL_SERVER_IMPORTER}, which demonstrably imports it. Import resolution is broken, so the clean client-graph result proves nothing.`,
  );
}

// Positive control 2 — with the `"use server"` boundary rule DISABLED, a real
// client component must reach the admin client through the server action it
// calls. This proves the clean arm-B result comes from the boundary rule doing
// its job, not from a walk that never traverses anything.
const CONTROL_CLIENT_ENTRY = "components/site/SiteLanding.tsx";
if (!reachServerOnly(CONTROL_CLIENT_ENTRY, { respectServerBoundary: false }).has("lib/supabase/admin.ts")) {
  vacuity.push(
    `B · client module graph: positive control failed — with the "use server" boundary disabled, ${CONTROL_CLIENT_ENTRY} should reach lib/supabase/admin.ts through app/enquiry-actions.ts. It did not, so the boundary rule is not what is producing the clean result.`,
  );
}

// ---------------------------------------------------------------------------
// Arm C — built client bundle (and, optionally, a downloaded deployed bundle)
// ---------------------------------------------------------------------------

function scanBundleDir(
  arm,
  dir,
  { minimumJsFiles = 60, minimumBytes = 1_000_000 } = {},
) {
  const files = walkFiles(dir);
  const jsFiles = files.filter((f) => f.endsWith(".js"));
  let bytes = 0;
  for (const abs of files) {
    const text = readText(abs);
    bytes += text.length;
    scan(arm, BUNDLE_DETECTORS, relative(REPO_ROOT, abs), text);
  }
  floor(arm, "client asset files scanned", jsFiles.length, minimumJsFiles);
  floor(arm, "bytes scanned", bytes, minimumBytes);
  return { files: files.length, jsFiles: jsFiles.length, bytes };
}

const NEXT_STATIC = join(APP_DIR, ".next", "static");
const BUILD_MANIFEST = join(APP_DIR, ".next", "build-manifest.json");
let localBundle = { files: 0, bytes: 0 };

if (!existsSync(NEXT_STATIC)) {
  vacuity.push(
    `C · built client bundle: ${relative(REPO_ROOT, NEXT_STATIC)} is missing — run \`npm run build\` before this guard. Arms A and B alone do not prove L-8.`,
  );
} else {
  if (!existsSync(BUILD_MANIFEST)) {
    vacuity.push(
      `C · built client bundle: ${relative(REPO_ROOT, BUILD_MANIFEST)} is missing — the Next output layout changed, so "found nothing" may mean "looked in the wrong place".`,
    );
  }
  localBundle = scanBundleDir("C · built client bundle", NEXT_STATIC);
}

const bundleDirArg = process.argv.indexOf("--bundle-dir");
let deployedBundle = null;
if (bundleDirArg !== -1) {
  const dir = process.argv[bundleDirArg + 1];
  if (!dir || !existsSync(dir)) {
    vacuity.push(`C' · deployed bundle: --bundle-dir "${dir ?? ""}" does not exist.`);
  } else {
    deployedBundle = scanBundleDir("C' · deployed bundle", dir, {
      minimumJsFiles: 10,
      minimumBytes: 100_000,
    });
  }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const fail = (title, lines) => {
  console.error(`\n❌ service-role exposure guard FAILED — ${title}\n`);
  for (const l of lines) console.error(`  - ${l}`);
  console.error("");
  process.exit(1);
};

if (selfTestFailures.length) {
  fail("detector self-tests (arm D)", selfTestFailures);
}
if (findings.length) {
  fail(
    "a service-role secret or its client-inlining shape was found",
    findings.map((f) => {
      const where = f.offset === null ? "" : ` @ byte ${f.offset}`;
      const what = f.detail ?? DETECTORS[f.detector]?.describe ?? f.detector;
      return `[${f.arm}] ${f.file}${where}\n      ${f.detector} — ${what}`;
    }).concat([
      "",
      "The matched VALUE is deliberately not printed. Locate it at the byte offset,",
      "then treat the key as compromised: rotate it in Supabase BEFORE removing it,",
      "because it is already in the artefact's history.",
    ]),
  );
}
if (vacuity.length) {
  fail("the scan could not prove it looked (non-vacuity floors)", vacuity);
}

console.log(
  `✅ service-role exposure guard (payroll access review L-8, source + local-build subparts):\n` +
    `   A · repository artefacts   — ${repoScanned} git-tracked files (${repoBytes.toLocaleString()} bytes), no secret value, no NEXT_PUBLIC_ secret env name\n` +
    `   B · client module graph    — ${clientEntries.length} "use client" entries over ${sourceFiles.length} source files (${resolvedEdges} import edges); none reaches ${SERVER_ONLY_MODULES.join(" / ")}; both positive controls passed\n` +
    `   C · built client bundle    — ${localBundle.files} assets under .next/static (${localBundle.bytes.toLocaleString()} bytes), no secret value, no server-only env name\n` +
    (deployedBundle
      ? `   C' · deployed bundle      — ${deployedBundle.jsFiles} JavaScript chunks / ${deployedBundle.files} downloaded files (${deployedBundle.bytes.toLocaleString()} bytes), clean\n`
      : `   C' · deployed bundle      — NOT REFRESHED (pass --bundle-dir <dir> with downloaded chunks)\n`) +
    `   D · detector self-tests    — ${SELF_TESTS.length}/${SELF_TESTS.length} detectors fired on a positive fixture and stayed silent on a benign one`,
);
