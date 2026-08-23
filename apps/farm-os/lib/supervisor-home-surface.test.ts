import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const component = read("app/(app)/m/supervisor-home.tsx");
const fieldPage = read("app/(app)/m/page.tsx");
const executePage = read("app/(app)/m/execute/[opId]/page.tsx");
const executeAction = read("app/(app)/m/execute/[opId]/actions.ts");
const plansPage = read("app/(app)/plans/page.tsx");
const plansDashboard = read("app/(app)/plans/dashboard/page.tsx");
const planDetail = read("app/(app)/plans/[planId]/page.tsx");
const nav = read("lib/nav.ts");
const parser = read("lib/supervisor-home-reads.ts");

const ALLOWED_LINK_ROOTS = ["/m/execute", "/record/activity", "/people/attendance"];

function hrefs(source: string): string[] {
  return [...source.matchAll(/href=[{"]`?(\/[A-Za-z0-9\-_/]*)/g)].map((match) => match[1]);
}

describe("supervisor home surface", () => {
  it("uses one bounded supervisor snapshot and no direct table reads", () => {
    expect(component.split('supabase.rpc("fn_supervisor_home_snapshot"').length - 1).toBe(1);
    expect(component).not.toContain(".from(");
    expect(component).not.toContain("Promise.all(");
    expect(component).toContain("parseSupervisorHomeSnapshot(data, orgId, asOf)");
    expect(component).toContain("SUPERVISOR_HOME_DETAIL_LIMIT");
    expect(component).toContain("cairoTodayIso(new Date())");
  });

  it("branches the supervisor before any legacy field read", () => {
    const gate = fieldPage.indexOf('requireRole(["supervisor", "agri_engineer", "farm_manager", "owner"])');
    const branch = fieldPage.indexOf('if (m.role === "supervisor") return <SupervisorHome');
    const firstLegacyRead = fieldPage.indexOf('sb.from("plans")');
    expect(gate).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(gate);
    expect(firstLegacyRead).toBeGreaterThan(branch);
    // createClient must not run for the supervisor before the branch.
    expect(fieldPage.indexOf("await createClient()")).toBeGreaterThan(branch);
  });

  it("leaves the other field roles' workflow in place", () => {
    expect(fieldPage).toContain('const agronomyOnly = scope === "agronomy"');
    expect(fieldPage).toContain('{(m.role === "owner" || m.role === "farm_manager") && (');
    expect(fieldPage).toContain('href="/m/harvest"');
    expect(fieldPage).toContain('<Section title="متأخرة"');
    expect(fieldPage).toContain('<Section title="اليوم"');
    expect(fieldPage).toContain('<Section title="قادم"');
  });

  it("shows exactly four recorded supervisor KPIs", () => {
    expect(component.split("<KpiCard").length - 1).toBe(4);
    for (const label of ["مهامي اليوم", "متأخر عن موعده", "موقوف حتى يُحل", "بلا موعد مسجل"]) {
      expect(component).toContain(label);
    }
  });

  it("links only to routes the supervisor may open", () => {
    const links = hrefs(component);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(ALLOWED_LINK_ROOTS.some((root) => href === root || href.startsWith(`${root}/`))).toBe(true);
    }
    expect(component).toContain("/record/activity");
    expect(component).toContain("/people/attendance");
    expect(component).toContain("`/m/execute/${row.id}`");
    // Destinations forbidden to the supervisor never appear.
    // `/plans/[planId]` renders التكلفة التقديرية and a per-operation cost column to any
    // member, so the supervisor is never routed there — blocked work escalates to a human.
    for (const forbidden of ["/plans", "/transactions", "/approvals", "/inventory", "/m/receive", "/settings", "/finance", "/people/payroll", "/m/harvest"]) {
      expect(component).not.toContain(forbidden);
    }
  });

  it("keeps every control at least 44px and free of emoji", () => {
    expect(component.split("minHeight: 44").length - 1).toBe(3);
    expect(component).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("preserves the offline execution outbox on the supervisor home", () => {
    expect(component).toContain("<PendingExecutions />");
    expect(component).toContain('import { PendingExecutions } from "@/components/PendingExecutions"');
  });

  it("exposes no finance value or accounting term anywhere", () => {
    expect(component).not.toMatch(/est_cost|unit_cost|egpExact|moneyNumber|جنيه|تكلفة|أجر|مصروف|ميزانية|موازنة|سعر/i);
    expect(parser).not.toMatch(/est_cost|unit_cost|egpExact|amount|price/i);
  });

  it("labels counts as recorded and never claims completeness without verified authority", () => {
    expect(component).toContain("المسجل الآن");
    expect(component).toContain("الأرقام هنا مسجلة فقط، وتغطية مصدر التشغيل غير مؤكدة");
    expect(component).toContain("attention.length > 0 || operationsVerified ? <AttentionInbox");
    expect(component).toContain('operationsVerified ? "لا توجد مهام مسندة إليك الآن"');
    expect(component).toContain("لا توجد مهام مسجلة مسندة إليك الآن");
    // Recorded counts are never blanked by a partial source.
    expect(component).not.toContain('"—"');
  });

  it("states the unlinked and ambiguous person states instead of showing zeros", () => {
    expect(component).toContain("recorded == null || drivers == null");
    expect(component).toContain("حسابك غير مرتبط بسجل موظف في هذه المؤسسة");
    expect(component).toContain("حسابك مرتبط بأكثر من سجل موظف في هذه المؤسسة");
    expect(component).toContain("لا يمكن عرض المهام المسندة إليك");
    expect(component).toContain("هذه ليست حالة «لا يوجد عمل»");
    expect(component).toContain("تعرض هذه الصفحة العمل المسند إليك وحدك، لا عمل الفريق كله.");
  });

  it("offers recording only for unblocked work and names every recorded blocker", () => {
    expect(component).toContain('action="execute"');
    expect(component).toContain('{action === "execute" && (');
    expect(component).toContain('rows={drivers.readyNow}');
    expect(component).toContain('rows={drivers.blockedNow}');
    expect(component).toContain("بانتظار توقيع المهندس الزراعي على الجرعة");
    expect(component).toContain("الموقع المسجل للعملية غير صالح");
    expect(component).toContain("وحدة المادة المسجلة تخالف وحدة الصنف");
    // The execute shortcut is never presented as a guarantee that the record will post.
    expect(component).toContain("وقد يرفضه النظام إن لم يكفِ المخزون وقت التنفيذ");
  });

  it("blocks an unsigned dose on the direct execution page without fetching money", () => {
    expect(executePage).toContain("signed_off_by, signed_off_at");
    expect(executePage).toContain("isDoseBearingSubtype(op.subtype)");
    expect(executePage).toContain("const canExecute = isExecutableOpStatus(op.status) && !doseSignoffMissing");
    expect(executePage).toContain("{canExecute ? (");
    expect(executePage).toContain("الجرعة غير معتمدة");
    expect(executePage).not.toContain("est_cost");
    expect(executeAction).toContain("return { ok: true, eventId: result.event_id }");
    expect(executeAction).not.toContain("actualCost:");
  });

  it("keeps money-bearing planning routes unavailable to a supervisor even by direct URL", () => {
    const allowed = 'requireRole(["owner", "accountant", "farm_manager", "agri_engineer"])';
    expect(plansPage).toContain(allowed);
    expect(plansDashboard).toContain(allowed);
    expect(planDetail).toContain(allowed);
    expect(nav).toContain('roles: ["owner", "accountant", "farm_manager", "agri_engineer"]');
  });

  it("keeps multi-day, overdue and undated semantics explicit", () => {
    expect(component).toContain("المسجل ضمن مدى التنفيذ اليوم");
    expect(component).toContain("المسجل بعد نهاية موعد التنفيذ");
    expect(component).toContain("فلا تُحسب ضمن اليوم ولا ضمن المتأخر");
    expect(component).toContain('row.endsOn && row.endsOn !== row.plannedAt');
    expect(component).toContain('snapshot.drivers?.readyNow.some((row) => row.urgency === "overdue")');
    expect(component).toContain('snapshot.drivers?.readyNow.some((row) => row.urgency === "today")');
    expect(component).toContain('snapshot.drivers?.blockedNow.some((row) => row.urgency === "today")');
    expect(component).toContain(': "#supervisor-blocked"');
  });

  it("formats every displayed number and date in Arabic-Indic digits", () => {
    expect(component).toContain('new Intl.NumberFormat("ar-EG")');
    expect(component).toContain("formatDecimalArabic");
    expect(component).toContain("fmtDate(snapshot.asOf)");
    expect(component).not.toMatch(/toLocaleString\(\)|String\(\s*Number\(/);
  });

  it("shows the recorded total behind every truncated nested sample", () => {
    expect(component).toContain("مادة مسجلة أخرى");
    expect(component).toContain("زميل مسجل آخر");
    expect(component).toContain("BigInt(row.materialCount) - BigInt(row.materials.length)");
    expect(component).toContain("BigInt(row.crewCount) - BigInt(row.crew.length)");
  });
});
