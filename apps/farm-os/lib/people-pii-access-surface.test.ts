import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { COMPENSATION_PERSON_COLUMNS, COMPENSATION_ROW_COLUMNS } from "./compensation-read";
import { PAYROLL_PERSON_COLUMNS } from "./payroll-report";

/**
 * REPO-WIDE contact-PII and payroll-read invariants (Stage-M access review).
 *
 * WHAT IS ALREADY PINNED, AND WHY THIS IS NOT THAT. `payroll-surface.test.ts`,
 * `attendance-surface.test.ts`, `compensation-read.test.ts` and `payroll-report.test.ts` each assert
 * that THEIR OWN surface selects no phone/email — file lists and query-recorder assertions scoped to
 * the payroll, attendance and compensation paths. None of them says anything about the other ~17
 * `.from("people")` reads scattered across plans, reports, custody, the mobile route, the owner
 * dashboard and settings. This file closes that: it walks EVERY app/ and lib/ source and checks each
 * `people` read individually, so a new route added months from now is covered without anyone
 * remembering to extend a list.
 *
 * WHY IT MATTERS. `people.phone`/`people.email` are denied to `authenticated` at the COLUMN-GRANT
 * layer (migration 20260622000048), so a query that asks for them does not silently return null — it
 * fails the WHOLE statement with 42501 and takes the page down with it. The database is therefore
 * already the boundary; this test exists so that boundary is never REACHED, and — more importantly for
 * the review — so nobody can introduce a `select("*")` on `people`, which both breaks at runtime and
 * signals an author who believed contact columns were readable.
 *
 * NON-VACUITY IS ENFORCED PER FILE, NOT IN AGGREGATE. A static scan's real failure mode is not a
 * false alarm, it is a silent empty set: rename the query builder, or reflow one chain past the
 * parser's window, and every assertion here passes on nothing. An aggregate floor does not catch
 * that, because one file with several projections covers the shortfall of a file with none. So each
 * file that contains a `people` chain must resolve at least one, and every chain it resolves must
 * land on a known PostgREST verb — see the first two cases below.
 *
 * These are STATIC source assertions. They prove intent and shape, never enforcement: enforcement is
 * the 0048 column grant and the payroll.read RLS, pinned in pgTAP (tests 46/48/56/142). A green run
 * here is not evidence that any role is denied anything — only that no app code asks.
 */

const APP_ROOT = process.cwd();

/** Every .ts/.tsx source under a directory, excluding tests and build output. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") return [];
    if (statSync(path).isDirectory()) return walk(path);
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.test\.tsx?$/.test(entry)) return [];
    return [path];
  });
}

const SOURCES = [...walk(join(APP_ROOT, "app")), ...walk(join(APP_ROOT, "lib"))];
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(APP_ROOT, path);

/**
 * Block comments and whole-line `//` comments removed.
 *
 * Query chains get QUOTED in prose here — `app/(app)/plans/[planId]/page.tsx` mentions
 * ``.from("people")`` twice in explanatory comments. Scanning raw text would count those as
 * chains, and a prose mention has no `.select(...)` of its own, so the per-file resolution floor
 * below would either fail on a comment or silently borrow the projection of the next real chain.
 * Only trailing `//` on a code line is left alone, deliberately: stripping it would need string
 * awareness (`"https://…"`), and a chain hidden behind one would still be caught, not missed.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The comment-free source. Used by every QUERY scan; the export/prop scans below read raw text. */
const code = (path: string) => stripComments(read(path));

/** The PostgREST verbs a `.from(...)` chain can resolve to. Anything else is an unparsed chain. */
const CHAIN_VERBS = ["select", "insert", "update", "upsert", "delete"] as const;
const CHAIN_VERB = new RegExp(`\\.(${CHAIN_VERBS.join("|")})\\(`);

interface QueryChain {
  /** The first PostgREST verb applied to the chain, or "" when none was found (an unparsed chain). */
  verb: string;
  /** The `.select(...)` argument belonging to this chain — a read projection, or a write's returning. */
  projection: string | null;
}

/**
 * One entry per `.from("<table>")` occurrence in a source file — never fewer, so a chain the parser
 * fails to understand shows up as an unresolved verb rather than as an absent entry.
 *
 * The chain is written across several lines everywhere in this codebase, so the window is generous,
 * but it is CUT at the next `.from("` in the file. Without that bound a write-only chain
 * (`createPerson`'s `.from("people").insert({...})`) would reach forward and adopt the `.select(` of
 * an unrelated later query, which is exactly how an unchecked projection would hide.
 */
function chainsFor(source: string, table: string): QueryChain[] {
  const chains: QueryChain[] = [];
  const fromToken = `.from("${table}")`;
  let index = source.indexOf(fromToken);
  while (index !== -1) {
    const nextFrom = source.indexOf('.from("', index + 1);
    const end = nextFrom === -1 ? index + 600 : Math.min(index + 600, nextFrom);
    const window = source.slice(index, end);
    const verb = CHAIN_VERB.exec(window);
    // `[^)]` already spans newlines, so no dotAll flag is needed (and the tsconfig target forbids it).
    const projection = /\.select\(\s*([^)]*?)\s*\)/.exec(window);
    chains.push({ verb: verb ? verb[1] : "", projection: projection ? projection[1].trim() : null });
    index = source.indexOf(fromToken, index + fromToken.length);
  }
  return chains;
}

/** Every `.select(...)` argument a file applies to a table — read projections and write returnings alike. */
function projectionsFor(path: string, table: string): string[] {
  return chainsFor(code(path), table)
    .map((chain) => chain.projection)
    .filter((projection): projection is string => projection !== null);
}

/**
 * A select argument may be a plain string literal, or one of these named column constants. Anything
 * else is rejected outright: an unrecognised identifier (or a computed/interpolated projection) hides
 * the column list from this check, which is exactly how a phone/email read would get back in.
 */
const ALLOWED_COLUMN_CONSTANTS: Record<string, string> = {
  COMPENSATION_PERSON_COLUMNS,
  COMPENSATION_ROW_COLUMNS,
  PAYROLL_PERSON_COLUMNS,
};

/** The one `.from("people")` chain in the repo that is a WRITE, so has no read projection to check. */
const PEOPLE_WRITE_CHAIN = join("app", "(app)", "people", "actions.ts");

describe("no app or lib code reads staff contact PII from people", () => {
  const readers = SOURCES.filter((path) => code(path).includes('.from("people")'));

  it("resolves every people chain in every file that has one — per file, not in aggregate", () => {
    // NON-VACUITY, THE PART THAT MATTERS. An aggregate floor (`parsed >= readers.length`) is
    // satisfiable while a whole file goes unparsed: `people/[personId]/page.tsx` alone contributes
    // two projections, so it can cover for a file whose chain the parser no longer understands, and
    // every assertion below then skips that file silently. So the floor is applied PER FILE: each
    // reader must resolve at least one chain, and every chain it resolves must land on a known
    // PostgREST verb — an unresolved chain fails here instead of vanishing from the scan.
    expect(readers.length).toBeGreaterThan(5);
    for (const path of readers) {
      const chains = chainsFor(code(path), "people");
      expect(chains.length, `${rel(path)}: no .from("people") chain resolved`).toBeGreaterThan(0);
      for (const chain of chains) {
        expect(
          CHAIN_VERBS as readonly string[],
          `${rel(path)}: a .from("people") chain resolves to no PostgREST verb`,
        ).toContain(chain.verb);
        if (chain.verb === "select") {
          expect(
            chain.projection,
            `${rel(path)}: a .from("people") read parsed no projection`,
          ).toBeTypeOf("string");
        }
      }
    }
  });

  it("exempts exactly one people chain from the projection floor — the gated createPerson insert", () => {
    // The per-file floor above requires a projection only from READ chains, which is a hole unless
    // the set of write chains is itself pinned. `createPerson` is the sole direct `people` write
    // (RLS `people.write` + the same-org trigger are its gate); a second one appearing here means a
    // new write path landed and must be reviewed, not quietly excused from the projection check.
    const writers = readers.flatMap((path) =>
      chainsFor(code(path), "people")
        .filter((chain) => chain.verb !== "select")
        .map((chain) => `${rel(path)} → .${chain.verb}()`),
    );
    expect(writers).toEqual([`${PEOPLE_WRITE_CHAIN} → .insert()`]);
  });

  it("parses real projections out of the readers, including a known literal (non-vacuity)", () => {
    const parsed = readers.flatMap((path) => projectionsFor(path, "people"));
    expect(parsed.length).toBeGreaterThanOrEqual(readers.length - 1); // − the one write-only file
    expect(parsed).toContain('"id, name"');
  });

  it("never selects phone or email, in any file, through any projection", () => {
    for (const path of readers) {
      for (const arg of projectionsFor(path, "people")) {
        expect(arg, `${rel(path)} → .select(${arg})`).not.toMatch(/phone|email/i);
      }
    }
  });

  it("never selects * from people — a wildcard would request the denied columns", () => {
    for (const path of readers) {
      for (const arg of projectionsFor(path, "people")) {
        expect(arg, `${rel(path)} → .select(${arg})`).not.toMatch(/^["'`]\s*\*\s*["'`]$/);
      }
    }
  });

  it("projects people through a string literal or a known column constant, never an opaque value", () => {
    for (const path of readers) {
      for (const arg of projectionsFor(path, "people")) {
        const isLiteral = /^["'`][^"'`]*["'`]$/.test(arg);
        const isKnownConstant = Object.hasOwn(ALLOWED_COLUMN_CONSTANTS, arg);
        expect(isLiteral || isKnownConstant, `${rel(path)} → .select(${arg})`).toBe(true);
      }
    }
  });

  it("keeps the named column constants free of contact PII too", () => {
    for (const [name, value] of Object.entries(ALLOWED_COLUMN_CONSTANTS)) {
      expect(value, name).not.toMatch(/phone|email|\*/i);
    }
  });

  it("embeds no phone or email through a PostgREST people(...) join either", () => {
    // `people(name)` style embeds bypass the `.from("people")` scan entirely — attendance already
    // uses one (`people(name)`), so the shape is live in this codebase and must be checked.
    const found: string[] = [];
    for (const path of SOURCES) {
      const embeds = code(path).match(/people\s*\([^)]*\)/g) ?? [];
      for (const embed of embeds) {
        found.push(embed);
        expect(embed, `${rel(path)} → ${embed}`).not.toMatch(/phone|email/i);
      }
    }
    // Floored too: if the embed syntax changes, this must fail rather than pass on an empty scan.
    expect(found, "no people(...) embed found — the scan matched nothing").toContain("people(name)");
  });
});

describe("payroll run tables are read only from the owner/accountant surface", () => {
  // The equivalent invariant for people_compensation lives in payroll-surface.test.ts. The RUN tables
  // (payroll_runs / payroll_run_lines) had no such pin: their only readers are in lib/payroll-report.ts,
  // which is a module, so the gate lives in whichever route imports it — the thing that can regress.
  const REPORT_MODULE = "@/lib/payroll-report";
  const OWNER_ACCOUNTANT = /requireRole\(\s*\[\s*"owner",\s*"accountant"\s*\]\s*\)/;

  const directReaders = SOURCES.filter((path) =>
    /\.from\("payroll_runs?(_lines)?"\)/.test(code(path)),
  );
  const routeConsumers = walk(join(APP_ROOT, "app")).filter((path) => {
    const source = code(path);
    return source.includes(REPORT_MODULE) && /\bloadPayroll|\bPAYROLL_RUN|\bloadPayrollRun/.test(source);
  });

  it("keeps every direct payroll_runs/payroll_run_lines read inside lib/payroll-report.ts", () => {
    expect(directReaders.length).toBeGreaterThan(0);
    for (const path of directReaders) {
      expect(rel(path)).toBe(join("lib", "payroll-report.ts"));
    }
  });

  it("gates every route that loads a payroll run on owner/accountant", () => {
    expect(routeConsumers.length).toBeGreaterThan(0);
    for (const path of routeConsumers) {
      expect(OWNER_ACCOUNTANT.test(read(path)), rel(path)).toBe(true);
    }
  });
});

describe("wage figures are never offered as a CSV download", () => {
  // The people module DOES export CSV — `/people` and `/people/dashboard` each hand a
  // `exportFilename` to a table. Those tables carry roster columns only (name, position, employment
  // type, open operations). The two surfaces that render MONEY are deliberately print-only: the
  // payroll pages use PrintButton, and the dashboard's hourly estimate uses a bare SimpleTable with
  // no export. That distinction is one prop wide, so it is pinned rather than trusted.
  const PAYROLL_DIR = join(APP_ROOT, "app", "(app)", "people", "payroll");
  const DASHBOARD = join(APP_ROOT, "app", "(app)", "people", "dashboard", "page.tsx");

  it("offers no CSV export anywhere on the payroll routes", () => {
    const files = walk(PAYROLL_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      expect(read(path), rel(path)).not.toContain("exportFilename");
    }
  });

  it("offers no CSV export on the people-dashboard wage estimate card", () => {
    const source = read(DASHBOARD);
    const start = source.indexOf("{payrollRun && (");
    expect(start, "the wage estimate block moved or was renamed").toBeGreaterThan(-1);
    const end = source.indexOf("</Card>", start);
    expect(end, "the wage estimate card has no closing </Card>").toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toContain("exportFilename");
  });

  it("keeps the dashboard's exported tables free of wage columns", () => {
    // The exported tables are the workload, unassigned-operations and directory tables. None may
    // grow a rate/gross/estimate column without this failing first.
    const source = read(DASHBOARD);
    for (const columnsBlock of ["workloadColumns", "directoryColumns", "operationColumns"]) {
      const start = source.indexOf(`const ${columnsBlock}`);
      expect(start, `${columnsBlock} not found`).toBeGreaterThan(-1);
      const end = source.indexOf("];", start);
      expect(source.slice(start, end)).not.toMatch(/gross|rate|wage|أجر|راتب/i);
    }
  });
});
