// SPEC-0033 R4c — the people directory and person 360 SURFACES.
//
// The parser tests prove the payload contract. These prove the PAGES actually use it: one bounded
// snapshot each, no direct table read left on either route, no money or contact PII rendered, no
// route offered to a role the route will bounce, every bounded sample labelled as a sample, and
// nothing that can only be read by scrolling sideways on a 390px phone.
//
// These are STATIC source assertions. They prove intent and shape, never enforcement: enforcement is
// `fn_people_directory_snapshot`/`fn_person_snapshot` plus RLS and the 0048 column grant, pinned in
// pgTAP test 231.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_HELP, helpForPath } from "./page-help";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * The file with its comment lines removed. Several of these files EXPLAIN the old unbounded
 * `.from("people")` read and the `est_cost` leak in prose, so a "this file never does that" check
 * has to look at the code rather than the commentary.
 */
const code = (source: string) =>
  source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

const directoryPage = read("app/(app)/people/page.tsx");
const directoryView = read("app/(app)/people/people-directory-view.tsx");
const personPage = read("app/(app)/people/[personId]/page.tsx");
const personView = read("app/(app)/people/[personId]/person-360-view.tsx");
const parser = read("lib/people-snapshot-reads.ts");
const context = read("lib/people-directory-context.ts");
const migration = read("supabase/migrations/20260823160000_exact_people_directory_and_person_snapshots.sql");

/**
 * The migration's executable SQL only: `--` commentary and the `comment on function` prose both
 * DESCRIBE what is deliberately not published (`est_cost`, `union all`), so scanning them would
 * flag the very sentences that document the contract.
 */
const sqlBody = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .replace(/comment on (function|column)[\s\S]*?';/g, "");

const VIEWS: [string, string][] = [["directory view", directoryView], ["person view", personView]];
const PAGES: [string, string][] = [["directory page", directoryPage], ["person page", personPage]];

/** Every literal route root a link in these views may point at. */
const ALLOWED_LINK_ROOTS = ["/people", "/plans"];

function hrefs(source: string): string[] {
  return [...source.matchAll(/href=[{"]`?(\/[A-Za-z0-9\-_/]*)/g)].map((match) => match[1]);
}

describe("people surfaces read one bounded snapshot", () => {
  it("does not leave the unauthenticated visual-review fixture in a production route", () => {
    expect(existsSync(join(process.cwd(), "app/(auth)/login/r4c-review-fixture/page.tsx"))).toBe(false);
  });

  it("calls exactly one snapshot RPC per page and reads no table directly", () => {
    expect(directoryPage.split('supabase.rpc("fn_people_directory_snapshot"').length - 1).toBe(1);
    expect(personPage.split('supabase.rpc("fn_person_snapshot"').length - 1).toBe(1);
    for (const [name, source] of [...PAGES, ...VIEWS]) {
      const body = code(source);
      expect(body, name).not.toContain(".from(");
      expect(body, name).not.toContain("Promise.all(");
      // The two bugs this slice exists to fix must be impossible to reintroduce here.
      expect(body, name).not.toContain("plan_operation_assignees");
      expect(body, name).not.toContain("responsible_person_id");
      expect(body, name).not.toContain("est_cost");
    }
    expect(directoryPage).toContain("parsePeopleDirectorySnapshot(data, {");
    expect(personPage).toContain("parsePersonSnapshot(data, {");
  });

  it("asks for the page and the samples it is going to render, and no more", () => {
    expect(directoryPage).toContain("p_limit: PEOPLE_DIRECTORY_PAGE_SIZE");
    expect(directoryPage).toContain("p_offset: offset");
    expect(directoryPage).toContain("query: context.query");
    expect(directoryPage).toContain("filter: context.filter");
    expect(directoryPage).toContain("canWrite,");
    for (const argument of [
      "p_operation_limit: PERSON_OPERATION_SAMPLE",
      "p_performed_limit: PERSON_PERFORMED_EVENT_SAMPLE",
      "p_assigned_limit: PERSON_ASSIGNED_EVENT_SAMPLE",
      "p_report_limit: PERSON_DIRECT_REPORT_SAMPLE",
    ]) {
      expect(personPage, argument).toContain(argument);
    }
    // The parser is bound to the SAME arguments the RPC was called with, so a payload built for a
    // different request is refused rather than rendered.
    for (const expectation of [
      "operationLimit: PERSON_OPERATION_SAMPLE",
      "performedLimit: PERSON_PERFORMED_EVENT_SAMPLE",
      "assignedLimit: PERSON_ASSIGNED_EVENT_SAMPLE",
      "reportLimit: PERSON_DIRECT_REPORT_SAMPLE",
    ]) {
      expect(personPage, expectation).toContain(expectation);
    }
  });

  it("canonicalizes its url before it reads anything, and after a stale deep page", () => {
    expect(directoryPage).toContain("readPeopleDirectoryRequest(await searchParams)");
    expect(directoryPage).toContain("if (redirectTo) redirect(redirectTo);");
    expect(directoryPage).toContain("context.page > pageCount");
    expect(directoryPage).toContain("peopleDirectoryHref({ ...context, page: pageCount })");
    expect(personPage).toContain("const canonicalPersonId = personId.toLowerCase()");
    expect(personPage).toContain("readPersonRequest(canonicalPersonId, await searchParams)");
    expect(personPage).toContain("personId !== canonicalPersonId || redirectTo");
  });

  it("surfaces a read failure instead of rendering an empty roster", () => {
    for (const [name, source] of PAGES) {
      expect(source, name).toContain("if (error) throw error;");
    }
  });

  it("answers not-found for a person outside the active organization", () => {
    // The RPC returns SQL NULL for an unknown id AND for another organization's id, so this 404
    // cannot be used to learn that an id exists somewhere else.
    expect(personPage).toContain("if (data === null) notFound();");
    expect(personPage).toContain("if (!UUID.test(personId)) notFound();");
    expect(personPage).toContain("if (snapshot === null) notFound();");
  });
});

describe("people surfaces keep the role gate where it already was", () => {
  it("requires exactly the four roles both routes have always required", () => {
    for (const [name, source] of PAGES) {
      expect(source, name)
        .toContain('requireRole(["owner", "farm_manager", "agri_engineer", "accountant"])');
    }
  });

  it("derives the onboarding capability from the membership role in one place", () => {
    expect(directoryPage).toContain("canWritePeople(membership.role)");
    // The view never re-decides it: it renders the form only when the snapshot published the list.
    expect(directoryView).toContain("{snapshot.managerOptions !== null && (");
    expect(code(directoryView)).not.toContain("membership.role");
  });

  it("re-checks the same role set inside PostgreSQL, not only in React", () => {
    expect(migration.split("v_role not in ('owner', 'farm_manager', 'agri_engineer', 'accountant')").length - 1)
      .toBe(2);
    expect(migration).toContain("public.authorize('people.write', p_org)");
  });

  it("links only to routes every role that can reach these pages may open", () => {
    for (const [name, source] of VIEWS) {
      const links = hrefs(source);
      expect(links.length, name).toBeGreaterThan(0);
      for (const href of links) {
        expect(
          ALLOWED_LINK_ROOTS.some((root) => href === root || href.startsWith(`${root}/`)),
          `${name}: ${href}`,
        ).toBe(true);
      }
    }
    // `/people/attendance` is owner/farm_manager/supervisor only, so it is deliberately not offered.
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toContain("/people/attendance");
      expect(source, name).not.toContain("/people/payroll");
    }
  });
});

describe("people surfaces publish no PII, no wage and no money", () => {
  it("renders no contact field, no auth id and no money helper", () => {
    for (const [name, source] of [...PAGES, ...VIEWS]) {
      const body = code(source);
      for (const forbidden of [
        "phone", "email", "user_id", "userId", "moneyText", "egp(", "est_cost", "estCost",
        "compensation", "payroll", "wage",
      ]) {
        expect(body, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("keeps the forbidden-key walk in the parser, not just an absence of reads", () => {
    expect(parser).toContain("FORBIDDEN_KEYS");
    expect(parser).toContain("assertNoForbiddenKeys");
    for (const key of ["\"phone\"", "\"email\"", "\"user_id\"", "\"est_cost\"", "\"rate\""]) {
      expect(parser, key).toContain(key);
    }
  });
});

describe("people surfaces stay honest about what they are showing", () => {
  it("never presents a sample length as a total", () => {
    // Every list either states its own exact total beside it or renders the shared sample note.
    expect(personView).toContain("function SampleNote");
    expect(personView).toContain("وليست القائمة كلها");
    expect(personView.split("<SampleNote").length - 1).toBe(4);
    // A sample length may only ever be used to ask "is this list empty?" or to feed the note that
    // states it AS a sample beside its own exact total. It may never be rendered as a count.
    for (const [name, source] of VIEWS) {
      for (const line of code(source).split("\n")) {
        if (!line.includes("rows.length")) continue;
        expect(
          /rows\.length === 0/.test(line) || /shown=\{[A-Za-z.]*rows\.length\}/.test(line),
          `${name}: ${line.trim()}`,
        ).toBe(true);
      }
    }
  });

  it("publishes the exact totals beside the bounded page and every sample", () => {
    expect(directoryView).toContain("exactCount(counts.totalPeople)");
    expect(directoryView).toContain("exactCount(counts.matching)");
    expect(directoryView).toContain("هذه صفحة واحدة من الدليل، لا الدليل كله");
    expect(personView).toContain("exactCount(operations.openTotal)");
    expect(personView).toContain("exactCount(operations.total)");
    expect(personView).toContain("exactCount(performedEvents.total)");
    expect(personView).toContain("exactCount(assignedEvents.total)");
    expect(personView).toContain("exactCount(directReports.total)");
  });

  it("says what «open» means, rather than letting the old planned-only reading stand", () => {
    for (const [name, source] of VIEWS) {
      expect(source, name).toContain("لم تُنفَّذ ولم تُلغَ ولم تُحظر ولم تُتخطَّ");
    }
    expect(directoryView).toContain("الارتباطان يُحسبان مرة واحدة");
  });

  it("never turns an unrecorded value into a zero or a bare dash", () => {
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toMatch(/\?\?\s*0\b/);
      expect(source, name).not.toMatch(/\|\|\s*0\b/);
      expect(source, name).not.toContain('"—"');
    }
    expect(directoryView).toContain("لا عمل مفتوح مسجل الآن");
    expect(directoryView).toContain("بلا مدير مباشر مسجل");
    expect(personView).toContain("بلا تاريخ مخطط مسجل");
  });

  it("fabricates no verdict about a person or a date", () => {
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toMatch(/متأخر|متأخرة|إنتاجية|تقييم الأداء|نسبة الإنجاز/);
    }
    expect(personView).toContain("وليست تقييمًا لأداء");
  });

  it("says so when the operations source is not verified", () => {
    for (const [name, source] of VIEWS) {
      expect(source, name).toContain("isAuthoritative(snapshot.authority.operations)");
      expect(source, name).toContain("تغطية مصدر العمليات غير مؤكدة");
    }
  });

  it("no longer offers a whole-directory print or export from a bounded page", () => {
    for (const [name, source] of [...PAGES, ...VIEWS]) {
      expect(source, name).not.toContain("exportFilename");
      expect(source, name).not.toContain("PrintButton");
      expect(source, name).not.toContain("no-print");
    }
  });
});

describe("people surfaces are phone-first Arabic RTL", () => {
  it("renders every number and date through the Arabic-Indic helpers", () => {
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toMatch(/toLocaleString\(\)|\bnum\(|\begp\(/);
      expect(source, name).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(source, name).not.toContain("Number(");
      expect(source, name).not.toContain("parseInt(");
    }
    expect(directoryView).toContain("exactCount(");
    expect(personView).toContain("fmtDate(");
    expect(personView).toContain("fmtDateTime(");
  });

  it("has no axis to overflow on: one column, no table, no chart", () => {
    for (const [name, source] of VIEWS) {
      // Comment-stripped: the person view's header EXPLAINS the four `<table>`s it replaced.
      const body = code(source);
      for (const forbidden of [
        "SimpleTable", "FilterableTable", "MasterTable", "DataTable", "<table",
        "CategoryDoughnut", "CategoryBarChart", "TrendLineChart", "recharts",
        "overflow-x", "whitespace-nowrap", "min-w-[", "KpiCard",
      ]) {
        expect(body, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
      expect(body, name).toContain('className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4"');
      expect(body, name).not.toMatch(/text-2xl|text-3xl/);
    }
  });

  it("keeps every command control at least 44px", () => {
    for (const [name, source] of VIEWS) {
      const controls = source.split("minHeight: 44").length - 1;
      expect(controls, name).toBeGreaterThanOrEqual(3);
      // Every button-styled element carries the touch target, not just some of them.
      expect(controls, name).toBeGreaterThanOrEqual(source.split("fos-btn fos-btn--").length - 1);
    }
  });

  it("keeps the server/client boundary where RSC needs it", () => {
    // The pages and the two views are Server Components. The only client components they render are
    // the shared tab strip and the existing onboarding form — rendered, never called.
    for (const [name, source] of [...PAGES, ...VIEWS]) {
      expect(source, name).not.toContain('"use client"');
      expect(source, name).not.toContain("useState");
      expect(source, name).not.toContain("onClick");
    }
    // tabId/tabPanelId are CLIENT functions in the DS barrel; the server-safe mirror is the only
    // legal import for a Server Component (scripts/check-client-fn-in-server.mjs).
    expect(personView).toContain('from "@/lib/tab-ids"');
    expect(personView).not.toMatch(/import \{[^}]*tabId[^}]*\} from "@\/components\/ui"/);
    // The directory works with no JavaScript at all: search is a GET form, every control is a link.
    expect(directoryView).toContain('<form action="/people" method="get" role="search"');
  });
});

describe("the people return-link contract", () => {
  it("rebuilds every return path from validated parts instead of echoing the caller", () => {
    expect(personPage).toContain("readPersonRequest");
    expect(context).toContain("export function parsePeopleReturnTo");
    expect(context).toContain("if (path !== PEOPLE_DIRECTORY_PATH) return PEOPLE_DIRECTORY_PATH;");
    expect(context).toContain('raw.startsWith("//")');
    expect(context).toContain('raw.startsWith("/\\\\")');
    // The view only ever links to the already-validated value it was handed.
    expect(personView).toContain("href={returnTo}");
    expect(code(personView)).not.toContain("searchParams");
  });
});

describe("people surfaces are documented where the product explains itself", () => {
  it("keeps the page help truthful about the two rebuilt behaviours", () => {
    expect(PAGE_HELP.people.avoid).toContain("«عمل مفتوح»");
    expect(PAGE_HELP.people.avoid).toContain("لا يوجد تصدير");
    expect(PAGE_HELP["person-360"].avoid).toContain("عيّنة محدودة");
    expect(PAGE_HELP["person-360"].what).toContain("العمل المفتوح");
  });

  it("still resolves the person route to its own help, and the directory to the nav page", () => {
    expect(helpForPath("/people/22222222-2222-4222-8222-222222222221", "people"))
      .toBe(PAGE_HELP["person-360"]);
    expect(helpForPath("/people", "people")).toBe(PAGE_HELP.people);
  });
});

describe("the people snapshot contract itself", () => {
  it("stays locked to authenticated callers and to the active organization", () => {
    for (const fn of [
      "public.fn_people_directory_snapshot(uuid, text, text, integer, integer)",
      "public.fn_person_snapshot(uuid, uuid, integer, integer, integer, integer)",
    ]) {
      expect(migration).toContain(`revoke all on function ${fn} from public;`);
      expect(migration).toContain(`revoke all on function ${fn} from anon;`);
      expect(migration).toContain(`grant execute on function ${fn} to authenticated;`);
    }
    expect(migration.split("security invoker").length - 1).toBe(2);
    expect(migration.split("set search_path = ''").length - 1).toBe(2);
    expect(migration.split("active_org_id").length - 1).toBe(2);
  });

  it("decides open, de-duplication and the manager ceiling in SQL", () => {
    expect(sqlBody.split("not in ('done', 'blocked', 'abandoned', 'skipped')").length - 1)
      .toBeGreaterThanOrEqual(3);
    // `union`, never `union all`: being both the responsible person and an assignee counts once.
    expect(sqlBody).toContain("    union\n");
    expect(sqlBody).not.toContain("union all");
    expect(sqlBody).toContain("v_max_manager_options constant integer := 500");
    expect(sqlBody).toContain("v_manager_options <= v_max_manager_options");
    expect(sqlBody).toContain("else 'null'::jsonb");
    expect(sqlBody).not.toContain("manager option list is larger");
  });

  it("escapes the search's own LIKE metacharacters and bounds it before trimming", () => {
    expect(migration).toContain("v_max_raw_query constant integer := 200");
    expect(migration).toContain("v_max_query constant integer := 60");
    expect(migration).toContain("pg_catalog.replace(v_query, '\\', '\\\\')");
    expect(migration).toContain("escape '\\'");
  });

  it("leaves every count as text and never builds a money key", () => {
    expect(parser).toContain("ExactCountString");
    expect(sqlBody).toContain("::text from totals");

    // No forbidden key is ever BUILT. Every single-quoted literal followed by a comma is a
    // `jsonb_build_object` key (status literals inside `not in (...)` lists match too, harmlessly).
    const publishedKeys = [...sqlBody.matchAll(/'([a-z_][a-z0-9_]*)',/g)].map((match) => match[1]);
    expect(publishedKeys.length).toBeGreaterThan(20);
    for (const forbidden of [
      "phone", "email", "user_id", "rate", "wage", "gross", "est_cost", "unit_cost", "amount",
      "price", "created_by", "closed_by", "signed_off_by", "approved_by",
    ]) {
      expect(publishedKeys, forbidden).not.toContain(forbidden);
    }
    // And no forbidden COLUMN is even selected. `organization_member.user_id` is the authorization
    // lookup, never a published value, so the column checks are spelled against the tables that
    // carry the sensitive data.
    for (const forbidden of [
      "p.phone", "p.email", "p.user_id", "people.phone", "people.email", "people.user_id",
      "est_cost", "people_compensation", "payroll_run", "signed_off_by", "created_by",
    ]) {
      expect(sqlBody, forbidden).not.toContain(forbidden);
    }
  });
});
