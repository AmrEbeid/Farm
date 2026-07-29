import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "./auth";
import { APP_NAV, findActiveNavItem, visibleModulesForRole } from "./nav";
import { helpForPath } from "./page-help";

/**
 * Source-and-nav contract guard for «إقفال الرواتب».
 *
 * The payroll surface reads wage rates and closes an irreversible period, so three properties must
 * not regress silently: only owner/accountant can reach it, the close is confirmed before it is
 * sent and cannot be double-submitted, and no page ever selects contact PII or trusts a report
 * payload from the URL. tsc and eslint see none of these, so they are pinned here.
 */

const APP_ROOT = process.cwd();
const PAYROLL_DIR = join(APP_ROOT, "app", "(app)", "people", "payroll");
const LIST_PAGE = join(PAYROLL_DIR, "page.tsx");
const REPORT_PAGE = join(PAYROLL_DIR, "[runId]", "page.tsx");
const ACTIONS = join(PAYROLL_DIR, "actions.ts");
const CLOSE_FORM = join(PAYROLL_DIR, "close-form.tsx");
const COMP_DIR = join(PAYROLL_DIR, "compensation");
const COMP_PAGE = join(COMP_DIR, "page.tsx");
const COMP_ACTIONS = join(COMP_DIR, "actions.ts");
const COMP_EDITOR = join(COMP_DIR, "editor.tsx");

const ALL_ROLES: Role[] = [
  "owner",
  "farm_manager",
  "agri_engineer",
  "accountant",
  "supervisor",
  "storekeeper",
];
const ALLOWED: Role[] = ["owner", "accountant"];

const read = (path: string) => readFileSync(path, "utf8");
/** Every .ts/.tsx file under a directory — used to prove no OTHER route reads the wage table. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}
const navIds = (role: Role) =>
  visibleModulesForRole(role).flatMap((appModule) => appModule.pages.map((page) => page.id));

describe("payroll nav entry", () => {
  it("exists once, under the people module, pointing at the real route", () => {
    const entries = APP_NAV.filter((item) => item.id === "payroll");
    expect(entries).toHaveLength(1);
    expect(entries[0].href).toBe("/people/payroll");
    expect(existsSync(LIST_PAGE)).toBe(true);
    expect(existsSync(REPORT_PAGE)).toBe(true);
  });

  it("is visible to owner and accountant, and to nobody else", () => {
    for (const role of ALL_ROLES) {
      expect(navIds(role).includes("payroll"), role).toBe(ALLOWED.includes(role));
    }
  });

  it("keeps the list and the report route on the payroll nav item", () => {
    expect(findActiveNavItem("/people/payroll")?.id).toBe("payroll");
    expect(findActiveNavItem(`/people/payroll/${"a".repeat(8)}`)?.id).toBe("payroll");
    // …without stealing the person directory's own routes.
    expect(findActiveNavItem("/people")?.id).toBe("people");
    expect(findActiveNavItem("/people/person-1")?.id).toBe("people");
  });

  it("gives both routes their own help, not the person-360 entry", () => {
    expect(helpForPath("/people/payroll", "payroll")?.title).toBe("إقفال الرواتب");
    expect(helpForPath("/people/payroll/run-1", "payroll")?.title).toBe("تقرير إقفال الرواتب");
    expect(helpForPath("/people/person-1", "people")?.title).toBe("ملف الشخص 360");
  });
});

describe("payroll access is re-established server-side on every surface", () => {
  it("both pages and the close action require owner/accountant", () => {
    for (const path of [LIST_PAGE, REPORT_PAGE, ACTIONS]) {
      expect(read(path), path).toMatch(/requireRole\(\s*\[\s*"owner",\s*"accountant"\s*\]\s*\)/);
    }
  });

  it("authorizes BEFORE it inspects the caller's input", () => {
    const source = read(ACTIONS);
    const body = source.slice(source.indexOf("export async function closePayrollRun"));
    const auth = body.indexOf("requireRole(");
    const firstInputRead = body.indexOf("typeof input");
    expect(auth).toBeGreaterThan(-1);
    expect(firstInputRead).toBeGreaterThan(auth);
    expect(body.indexOf("parsePayrollPeriod(")).toBeGreaterThan(auth);
  });

  it("the close action sends the SESSION org, never one from the caller", () => {
    const source = read(ACTIONS);
    expect(source).toContain("p_org: m.orgId");
    // No org may be read off the submitted input.
    expect(source).not.toMatch(/candidate\.org|input\.org|orgId:\s*candidate/i);
  });

  it("the close action calls the RPC directly, with no pre-check read that would race it", () => {
    const source = read(ACTIONS);
    expect(source).toContain('sb.rpc("fn_close_payroll_run"');
    // A `.from("payroll_runs")` here would be a check outside the RPC's per-org advisory lock.
    expect(source).not.toContain('.from("payroll_runs")');
    expect(source).not.toContain('.from("payroll_run_lines")');
  });

  it("the close action never returns raw DB text", () => {
    const source = read(ACTIONS);
    expect(source).toContain("payrollCloseFailure(error).message");
    expect(source).not.toMatch(/error\.message|error\.details|error\.hint/);
  });
});

describe("payroll close confirmation and pending protection", () => {
  const source = () => read(CLOSE_FORM);

  it("requires an explicit immutability confirmation on the client AND the server", () => {
    expect(source()).toContain("confirmImmutable: true");
    // The confirmation strip states the freeze in words before anything is sent.
    expect(source()).toContain("PAYROLL_FREEZE_WARNING_AR");
    expect(source()).toContain("تأكيد الإقفال");
    expect(read(ACTIONS)).toContain('candidate.confirmImmutable !== true');
  });

  it("names both halves of the boundary — no payment, no journal — in the confirmation", () => {
    expect(source()).toContain("لا يُدفع");
    expect(source()).toContain("قيد محاسبي");
  });

  it("uses no native browser dialog for the confirmation", () => {
    expect(source()).not.toMatch(/window\.(confirm|alert|prompt)\s*\(/);
  });

  it("guards against a duplicate submit with a pending flag", () => {
    const src = source();
    expect(src).toContain("const submittingRef = useRef(false)");
    expect(src).toMatch(/if\s*\(submittingRef\.current\)\s*return;/);
    expect(src).toContain("submittingRef.current = true");
    expect(src).toContain("submittingRef.current = false");
    expect(src).toContain("loading={pending}");
    expect(src).toContain("disabled={pending}");
  });

  it("announces the outcome to assistive technology", () => {
    expect(source()).toContain('role="alert"');
    expect(source()).toContain('aria-live="assertive"');
  });
});

describe("payroll pages stay fail-closed and PII-free", () => {
  it("validates the run id before any read and 404s a bad one", () => {
    const source = read(REPORT_PAGE);
    expect(source).toContain("if (!isUuid(runId)) notFound();");
    expect(source).toMatch(/load\.kind === "not_found"\)\s*notFound\(\)/);
  });

  it("renders a refusal, not figures, when the report cannot be read completely", () => {
    const source = read(REPORT_PAGE);
    const refusal = source.indexOf("if (!load.ok) {");
    const figures = source.indexOf("const { run, lines } = load;");
    expect(refusal).toBeGreaterThan(-1);
    expect(figures).toBeGreaterThan(refusal);
  });

  it("never accepts a report payload from the query string", () => {
    for (const path of [LIST_PAGE, REPORT_PAGE]) {
      const source = read(path);
      expect(source, path).not.toContain("searchParams");
      expect(source, path).not.toMatch(/JSON\.parse/);
    }
  });

  it("selects no phone or email anywhere on the payroll surface", () => {
    for (const path of [LIST_PAGE, REPORT_PAGE, ACTIONS, CLOSE_FORM]) {
      expect(read(path), path).not.toMatch(/phone|email/i);
    }
  });

  it("states the immutable / no-payment / no-journal boundary on both pages", () => {
    for (const path of [LIST_PAGE, REPORT_PAGE]) {
      const source = read(path);
      expect(source, path).toMatch(/قيد محاسبي|قيدًا محاسبيًا/);
      expect(source, path).toMatch(/مجمّد|يُجمّد/);
    }
  });

  it("keeps the compact header shape (text-xl, p-4, gap-4) and offers print", () => {
    for (const path of [LIST_PAGE, REPORT_PAGE]) {
      const source = read(path);
      expect(source, path).toContain('className="text-xl font-bold"');
      expect(source, path).not.toMatch(/text-(2|3|4|5)xl/);
      expect(source, path).toContain('className="flex flex-col gap-4 p-4"');
      expect(source, path).toContain("PrintButton");
    }
  });

  it("shows the stored close instant with the date-time formatter", () => {
    for (const path of [LIST_PAGE, REPORT_PAGE]) {
      expect(read(path), path).toContain("fmtDateTime(run.closedAt)");
    }
  });

  it("uses the shared Cairo calendar day for the close-form bound", () => {
    expect(read(LIST_PAGE)).toContain("const todayIso = cairoTodayIso()");
  });
});

/**
 * «أجور الفريق» — the compensation editor (SPEC-0006 slice 4). It is the ONLY surface in the app
 * that renders a wage rate, and the only one that writes one, so its role gate, its tenancy checks
 * and its no-delete posture are pinned here alongside the close.
 */
describe("compensation editor nav entry", () => {
  it("exists once, under the people module, pointing at the real route", () => {
    const entries = APP_NAV.filter((item) => item.id === "payroll-compensation");
    expect(entries).toHaveLength(1);
    expect(entries[0].href).toBe("/people/payroll/compensation");
    expect(existsSync(COMP_PAGE)).toBe(true);
  });

  it("is visible to owner and accountant, and to nobody else", () => {
    for (const role of ALL_ROLES) {
      expect(navIds(role).includes("payroll-compensation"), role).toBe(ALLOWED.includes(role));
    }
  });

  it("owns its own route and its own help — it is not the closed-run report", () => {
    expect(findActiveNavItem("/people/payroll/compensation")?.id).toBe("payroll-compensation");
    expect(helpForPath("/people/payroll/compensation", "payroll-compensation")?.title).toBe(
      "أجور الفريق",
    );
    // …and a real run id still resolves to the report, not to the editor.
    expect(helpForPath("/people/payroll/run-1", "payroll")?.title).toBe("تقرير إقفال الرواتب");
    expect(findActiveNavItem("/people/payroll/run-1")?.id).toBe("payroll");
  });
});

describe("compensation access is re-established server-side on every surface", () => {
  it("the page and the save action require owner/accountant", () => {
    for (const path of [COMP_PAGE, COMP_ACTIONS]) {
      expect(read(path), path).toMatch(/requireRole\(\s*\[\s*"owner",\s*"accountant"\s*\]\s*\)/);
    }
  });

  it("authorizes BEFORE it inspects the caller's input", () => {
    const source = read(COMP_ACTIONS);
    const body = source.slice(source.indexOf("export async function saveCompensation"));
    const auth = body.indexOf("requireRole(");
    expect(auth).toBeGreaterThan(-1);
    expect(body.indexOf("parseCompensationInput(")).toBeGreaterThan(auth);
  });

  it("writes the SESSION org, never one from the caller", () => {
    const source = read(COMP_ACTIONS);
    expect(source).toContain("org_id: m.orgId");
    expect(source).not.toMatch(/input\.org|candidate\.org|orgId:\s*input/i);
    // Every org filter on a write path is the session org.
    for (const match of source.match(/\.eq\("org_id",\s*[^)]+\)/g) ?? []) {
      expect(match).toContain("m.orgId");
    }
  });

  it("verifies the person is a SAME-ORG person before it writes", () => {
    const source = read(COMP_ACTIONS);
    const body = source.slice(source.indexOf("export async function saveCompensation"));
    const personCheck = body.indexOf('.from("people")');
    const write = body.indexOf('.from("people_compensation")');
    expect(personCheck).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(personCheck);
    // Fail closed: a failed lookup is a refusal, never an assumption the person exists.
    expect(body).toContain("if (personError) return");
    expect(body).toContain("if (!person) return");
  });

  it("requires an UPDATE to match the row's org AND its person, and refuses zero rows", () => {
    const source = read(COMP_ACTIONS);
    const update = source.slice(source.indexOf(".update(columns)"));
    expect(update).toContain('.eq("id", value.rowId)');
    expect(update).toContain('.eq("org_id", m.orgId)');
    expect(update).toContain('.eq("person_id", value.personId)');
    // It asks for the row back so "matched nothing" is observable, not silent success.
    expect(update).toContain('.select("id")');
    expect(update).toContain("if (!updated) return");
  });

  it("never deletes — people_compensation grants no client DELETE and none is attempted", () => {
    for (const path of [COMP_PAGE, COMP_ACTIONS, COMP_EDITOR]) {
      expect(read(path), path).not.toContain(".delete(");
      expect(read(path), path).not.toMatch(/deleteCompensation|removeCompensation/);
    }
  });

  it("never returns raw DB text", () => {
    const source = read(COMP_ACTIONS);
    expect(source).toContain("compensationFailure(error).message");
    expect(source).not.toMatch(/error\.message|error\.details|error\.hint/);
  });

  it("renders a refusal, not a partial list, when the bounded read fails", () => {
    const source = read(COMP_PAGE);
    const refusal = source.indexOf("!load.ok");
    const rows = source.indexOf("<CompensationEditor");
    expect(refusal).toBeGreaterThan(-1);
    expect(rows).toBeGreaterThan(refusal);
  });
});

describe("compensation editor form — shape and duplicate-submit protection", () => {
  const source = () => read(COMP_EDITOR);

  it("guards against a duplicate submit with a SYNCHRONOUS ref, checked first", () => {
    const src = source();
    expect(src).toContain("const submittingRef = useRef(false)");
    expect(src).toMatch(/if\s*\(submittingRef\.current\)\s*return;/);
    expect(src).toContain("submittingRef.current = true");
    expect(src).toContain("submittingRef.current = false");
    const handler = src.slice(src.indexOf("async function onSubmit"));
    const guard = handler.indexOf("if (submittingRef.current) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(handler.indexOf("await saveCompensation(")).toBeGreaterThan(guard);
    expect(handler.indexOf("setPending(true)")).toBeGreaterThan(guard);
  });

  it("shows a pending state and runs the shared validator before it submits", () => {
    const src = source();
    expect(src).toContain("loading={pending}");
    expect(src).toContain("disabled={pending}");
    expect(src).toContain("parseCompensationInput(");
    expect(read(COMP_ACTIONS)).toContain("parseCompensationInput(");
  });

  it("shows the unit only for piece and the contract bounds only for seasonal", () => {
    const src = source();
    expect(src).toMatch(/form\.mode === "piece" &&/);
    expect(src).toMatch(/form\.mode === "seasonal" &&/);
    expect(src).toContain("COMPENSATION_SEASONAL_EXACT_AR");
  });

  it("clears the fields a mode no longer owns, so a stale value cannot violate a CHECK", () => {
    const src = source();
    const changeMode = src.slice(src.indexOf("function changeMode"), src.indexOf("function edit"));
    expect(changeMode).toContain('next === "piece" ? form.unit : ""');
    expect(changeMode).toContain('next === "seasonal" ? form.start : ""');
    expect(changeMode).toContain('next === "seasonal" ? form.end : ""');
  });

  it("announces the outcome to assistive technology", () => {
    expect(source()).toContain('role="alert"');
    expect(source()).toContain('aria-live="assertive"');
  });
});

describe("wage data never leaves the owner/accountant surface", () => {
  it("selects no phone or email anywhere on the compensation surface", () => {
    for (const path of [COMP_PAGE, COMP_ACTIONS, COMP_EDITOR]) {
      expect(read(path), path).not.toMatch(/phone|email/i);
    }
  });

  it("keeps the compact header shape (text-xl, p-4, gap-4)", () => {
    const src = read(COMP_PAGE);
    expect(src).toContain('className="text-xl font-bold"');
    expect(src).not.toMatch(/text-(2|3|4|5)xl/);
    expect(src).toContain('className="flex flex-col gap-4 p-4"');
  });

  it("states the confidentiality boundary on the page itself", () => {
    expect(read(COMP_EDITOR)).toContain("COMPENSATION_CONFIDENTIAL_AR");
  });

  it("is the ONLY app route that reads people_compensation outside the payroll role set", () => {
    // Every other reader must sit behind owner/accountant too. The people dashboard reads it for the
    // hourly estimate and is itself gated on authorize('payroll.read') before it queries at all.
    const appDir = join(APP_ROOT, "app");
    const readers = walk(appDir).filter((file) =>
      readFileSync(file, "utf8").includes('from("people_compensation")'),
    );
    expect(readers.length).toBeGreaterThan(0);
    for (const file of readers) {
      const source = readFileSync(file, "utf8");
      const gated =
        /requireRole\(\s*\[\s*"owner",\s*"accountant"\s*\]\s*\)/.test(source) ||
        source.includes('sb.rpc("authorize", { perm: "payroll.read"');
      expect(gated, file).toBe(true);
    }
  });
});
