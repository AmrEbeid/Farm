import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "./auth";
import { APP_NAV, findActiveNavItem, visibleModulesForRole } from "./nav";
import { helpForPath } from "./page-help";

/**
 * Source-and-nav contract guard for «تسجيل الحضور».
 *
 * The attendance surface now writes the mode/quantity/unit that the payroll close prices against, so
 * three properties must not regress silently: the write authorizes from the SESSION before it reads
 * the caller's input and never accepts an org from them; the form cannot be double-submitted (unlike
 * the payroll close, an attendance insert is NOT idempotent); and no wage/rate ever appears on a
 * surface whose role set includes the supervisor. tsc and eslint see none of these, so they are
 * pinned here.
 */

const APP_ROOT = process.cwd();
const PAGE = join(APP_ROOT, "app", "(app)", "people", "attendance", "page.tsx");
const ACTIONS = join(APP_ROOT, "app", "(app)", "people", "actions.ts");
const FORM = join(APP_ROOT, "components", "LaborLogForm.tsx");

const ALL_ROLES: Role[] = [
  "owner",
  "farm_manager",
  "agri_engineer",
  "accountant",
  "supervisor",
  "storekeeper",
];
const ALLOWED: Role[] = ["owner", "farm_manager", "supervisor"];

const read = (path: string) => readFileSync(path, "utf8");
const navIds = (role: Role) =>
  visibleModulesForRole(role).flatMap((appModule) => appModule.pages.map((page) => page.id));

/** The body of `createLaborLog`, so the assertions cannot accidentally match `createPerson`. */
function createLaborLogBody(): string {
  const source = read(ACTIONS);
  const start = source.indexOf("export async function createLaborLog");
  expect(start, "createLaborLog not found in actions.ts").toBeGreaterThan(-1);
  return source.slice(start);
}

describe("attendance nav entry", () => {
  it("is visible to the labor.write roles, and to nobody else", () => {
    const entries = APP_NAV.filter((item) => item.id === "attendance");
    expect(entries).toHaveLength(1);
    expect(entries[0].href).toBe("/people/attendance");
    for (const role of ALL_ROLES) {
      expect(navIds(role).includes("attendance"), role).toBe(ALLOWED.includes(role));
    }
  });

  it("keeps its own route and its own help", () => {
    expect(findActiveNavItem("/people/attendance")?.id).toBe("attendance");
    expect(helpForPath("/people/attendance", "attendance")?.title).toBe("تسجيل الحضور");
  });
});

describe("attendance access is re-established server-side on every write", () => {
  it("the page and the action require the same labor.write role set", () => {
    const roleGate = /requireRole\(\s*\[\s*"owner",\s*"farm_manager",\s*"supervisor"\s*\]\s*\)/;
    expect(read(PAGE)).toMatch(roleGate);
    expect(createLaborLogBody()).toMatch(roleGate);
  });

  it("authorizes BEFORE it inspects the caller's input", () => {
    const body = createLaborLogBody();
    const auth = body.indexOf("requireRole(");
    expect(auth).toBeGreaterThan(-1);
    // The parse — the first thing that touches the payload — must come after the role gate.
    expect(body.indexOf("parseLaborLogInput(")).toBeGreaterThan(auth);
  });

  it("writes the SESSION org, never one from the caller", () => {
    const body = createLaborLogBody();
    expect(body).toContain("org_id: m.orgId");
    expect(body).not.toMatch(/input\.org|candidate\.org|orgId:\s*input/i);
  });

  it("takes the whole payload as `unknown` and writes only validated values", () => {
    const body = createLaborLogBody();
    expect(body).toMatch(/createLaborLog\(input: unknown\)/);
    // Every written column comes off the parsed value, never off the raw input.
    for (const field of ["person_id", "team_name", "work_date", "hours", "mode", "quantity", "unit", "note"]) {
      expect(body, field).toMatch(new RegExp(`${field}:\\s*entry\\.`));
    }
    expect(body).not.toMatch(/:\s*input\.[a-zA-Z]/);
  });

  it("never returns raw DB text", () => {
    const body = createLaborLogBody();
    expect(body).toContain("laborWriteFailure(error).message");
    expect(body).not.toMatch(/error\.message|error\.details|error\.hint/);
  });
});

describe("attendance form — mode-aware entry and duplicate-submit protection", () => {
  const source = () => read(FORM);

  it("guards against a duplicate submit with a SYNCHRONOUS ref, checked first", () => {
    const src = source();
    expect(src).toContain("const submittingRef = useRef(false)");
    expect(src).toMatch(/if\s*\(submittingRef\.current\)\s*return;/);
    expect(src).toContain("submittingRef.current = true");
    expect(src).toContain("submittingRef.current = false");
    // The ref check must precede the actual call and the pending state change in the handler.
    // (Indexes are taken on real statements, not on prose: a comment mentioning "await" would
    // otherwise satisfy or break this guard for the wrong reason.)
    const handler = src.slice(src.indexOf("async function onSubmit"));
    const guard = handler.indexOf("if (submittingRef.current) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(handler.indexOf("await createLaborLog(")).toBeGreaterThan(guard);
    expect(handler.indexOf("setPending(true)")).toBeGreaterThan(guard);
  });

  it("shows a pending state on the submit control and disables the inputs", () => {
    const src = source();
    expect(src).toContain("loading={pending}");
    expect(src).toContain("disabled={pending}");
  });

  it("runs the SAME pure validator the server action runs, before it submits", () => {
    expect(source()).toContain("parseLaborLogInput(");
    expect(createLaborLogBody()).toContain("parseLaborLogInput(");
  });

  it("offers every wage mode and every piece unit from the shared source", () => {
    const src = source();
    expect(src).toContain("LABOR_MODES.map");
    expect(src).toContain("LABOR_UNITS.map");
    // The piece fields exist and are conditional on the mode.
    expect(src).toMatch(/mode === "piece"/);
    expect(src).toContain('id="labor-quantity"');
    expect(src).toContain('id="labor-unit"');
  });

  it("keeps hours a required field for every mode", () => {
    const src = source();
    const hoursField = src.slice(src.indexOf('label="عدد الساعات"'));
    expect(hoursField.slice(0, 200)).toContain("required");
    // The hours field is NOT inside a mode conditional: it sits in the always-rendered grid.
    expect(src.indexOf('id="labor-hours"')).toBeLessThan(src.indexOf('mode === "piece" && ('));
    expect(src).toContain("LABOR_HOURS_ALWAYS_AR");
  });

  it("warns that a free-text team row blocks the payroll close", () => {
    expect(source()).toContain("LABOR_UNASSIGNED_TEAM_WARNING_AR");
    expect(source()).toMatch(/who === "team" &&/);
  });

  it("clears the piece fields when the mode leaves piece", () => {
    const src = source();
    const handler = src.slice(src.indexOf("onChange={(e) => {"), src.indexOf('id="labor-date"'));
    expect(handler).toContain('next !== "piece"');
    expect(handler).toContain('setQuantity("")');
    expect(handler).toContain('setUnit("")');
  });

  it("bounds the date input by the server-resolved Cairo day", () => {
    expect(source()).toContain("max={todayIso}");
    expect(read(PAGE)).toContain("todayIso={cairoTodayIso()}");
  });

  it("announces the outcome to assistive technology", () => {
    expect(source()).toContain('role="alert"');
    expect(source()).toContain('aria-live="assertive"');
  });
});

describe("attendance surface carries no wage data and no contact PII", () => {
  it("never reads a rate or the compensation table — a supervisor can reach this page", () => {
    // Checked against CODE, not prose: the page's header comment legitimately explains WHY rates are
    // absent here, and that explanation is worth keeping.
    for (const source of [read(PAGE), read(FORM), createLaborLogBody()]) {
      expect(source).not.toContain('.from("people_compensation")');
      expect(source).not.toContain('sb.rpc("fn_close_payroll_run"');
      // No `rate` column is ever selected, written or rendered on this surface.
      expect(source).not.toMatch(/["'`][^"'`]*\brate\b[^"'`]*["'`]\s*[,)\]]/);
      expect(source).not.toMatch(/\brate:\s/);
      expect(source).not.toMatch(/\.rate\b/);
    }
  });

  it("selects no phone or email", () => {
    for (const path of [PAGE, FORM]) {
      expect(read(path), path).not.toMatch(/phone|email/i);
    }
  });

  it("links to the wage surfaces only for the role that holds payroll.read too", () => {
    const source = read(PAGE);
    expect(source).toContain('const canOpenPayroll = m.role === "owner"');
    expect(source).toMatch(/canOpenPayroll && \(/);
  });

  it("keeps the compact header shape (text-xl, p-4, gap-4)", () => {
    const source = read(PAGE);
    expect(source).toContain('className="text-xl font-bold"');
    expect(source).not.toMatch(/text-(2|3|4|5)xl/);
    expect(source).toContain('className="flex flex-col gap-4 p-4"');
  });

  it("bounds and org-scopes both reads and offers only active people for new attendance", () => {
    const source = read(PAGE);
    const peopleRead = source.slice(source.indexOf('.from("people")'), source.indexOf('.from("labor_logs")'));
    const logsRead = source.slice(source.indexOf('.from("labor_logs")'));
    expect(source).toContain("ATTENDANCE_PEOPLE_LIMIT");
    expect(source).toContain("ATTENDANCE_LOG_LIMIT");
    expect(source.match(/\.eq\("org_id", m\.orgId\)/g) ?? []).toHaveLength(2);
    expect(source.match(/\.limit\(/g) ?? []).toHaveLength(2);
    expect(peopleRead).toContain('.eq("org_id", m.orgId)');
    expect(peopleRead).toContain('.eq("active", true)');
    expect(peopleRead).toContain(".limit(ATTENDANCE_PEOPLE_LIMIT)");
    expect(logsRead).toContain('.eq("org_id", m.orgId)');
    expect(logsRead).toContain(".limit(ATTENDANCE_LOG_LIMIT)");
    expect(source).toContain("people={(people ?? []).map");
  });
});
