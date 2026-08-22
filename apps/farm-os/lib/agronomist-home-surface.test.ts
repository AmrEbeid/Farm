import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const component = read("app/(app)/dashboard/manager/agronomist-home.tsx");
const router = read("app/(app)/dashboard/manager/page.tsx");
const fieldPage = read("app/(app)/m/page.tsx");

const ALLOWED_LINK_ROOTS = ["/approvals", "/m", "/farm/pest-scouting", "/plans"];

function hrefs(source: string): string[] {
  return [...source.matchAll(/href=[{"]`?(\/[A-Za-z0-9\-_/]*)/g)].map((match) => match[1]);
}

describe("agronomist home surface", () => {
  it("uses one bounded agronomist snapshot and no direct table reads", () => {
    expect(component.split('supabase.rpc("fn_agronomist_home_snapshot"').length - 1).toBe(1);
    expect(component).not.toContain(".from(");
    expect(component).not.toContain("Promise.all(");
    expect(component).toContain("parseAgronomistHomeSnapshot(data, orgId, asOf)");
    expect(component).toContain("AGRONOMIST_HOME_DETAIL_LIMIT");
  });

  it("is routed for agri_engineer before the farm manager branch", () => {
    const role = router.indexOf('requireRole(["farm_manager", "agri_engineer"])');
    const agronomist = router.indexOf('if (m.role === "agri_engineer") return <AgronomistHome orgId={m.orgId} />');
    expect(role).toBeGreaterThan(-1);
    expect(agronomist).toBeGreaterThan(role);
    expect(router).not.toContain("createClient");
    expect(router).not.toContain(".from(");
  });

  it("shows exactly four recorded agronomy KPIs", () => {
    expect(component.split("<KpiCard").length - 1).toBe(4);
    for (const label of [
      "جرعات ورش تنتظر توقيعك",
      "أعمال زراعية اليوم",
      "أعمال زراعية متأخرة",
      "مصائد تحتاج متابعة",
    ]) {
      expect(component).toContain(label);
    }
  });

  it("links only to the agronomist's own destinations", () => {
    const links = hrefs(component);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(ALLOWED_LINK_ROOTS.some((root) => href === root || href.startsWith(`${root}/`))).toBe(true);
    }
    expect(links).toContain("/approvals");
    expect(links).toContain("/m");
    expect(links).toContain("/farm/pest-scouting");
    expect(links).toContain("/plans/");
    expect(component).toContain("/m?scope=agronomy&mine=0");
  });

  it("formats recorded decimal quantities with Arabic digits", () => {
    expect(component).toContain("formatDecimalArabic");
    expect(component).toContain("decimal(material.qty)");
    expect(component).toContain("decimal(material.reiHours)");
    expect(component).toContain("decimal(material.phiDays)");
  });

  it("drills into the same active-plan, agronomy, Cairo multi-day contract", () => {
    expect(fieldPage).toContain('const agronomyOnly = scope === "agronomy"');
    expect(fieldPage).toContain('.eq("status", "active")');
    expect(fieldPage).toContain('"fertilization", "spraying", "irrigation", "pollination", "inspection", "pest_scouting"');
    expect(fieldPage).toContain("const todayStr = cairoDateString()");
    expect(fieldPage).toContain("const effectiveEnd");
    expect(fieldPage).toContain("start <= todayStr && end >= todayStr");
    expect(fieldPage).toContain('.not("planned_at", "is", null)');
    expect(fieldPage).toContain('agronomyOnly ? "أعمال الفريق المخطّطة"');
  });

  it("exposes no finance value anywhere", () => {
    expect(component).not.toMatch(/est_cost|egpExact|moneyNumber|جنيه|قيمة مالية|إجمالي التكلفة|تكلفة/i);
  });

  it("labels counts as recorded and never claims completeness without verified authority", () => {
    expect(component).toContain("المسجل الآن");
    expect(component).toContain("الأرقام هنا مسجلة فقط، وتغطية مصدر التشغيل غير مؤكدة");
    expect(component).toContain("attention.length > 0 || operationsVerified ? <AttentionInbox");
    expect(component).toContain('operationsVerified ? "لا توجد أعمال زراعية أو توقيعات تحتاج قرارا الآن"');
    expect(component).toContain("لا توجد بنود مسجلة للمتابعة الآن");
    // Recorded counts are never blanked by a partial source.
    expect(component).not.toContain('"—"');
  });

  it("keeps agronomy advisory and never asserts registration validity", () => {
    expect(component).toContain("محتوى التسميد والرش قالب قابل للتعديل، وليس وصفة");
    expect(component).toContain("مرجع تسجيل مسجل");
    expect(component).toContain("بلا مرجع تسجيل مسجل");
    expect(component).toContain('const isSpray = operation.subtype === "spraying"');
    // The registration reference is shown as recorded-or-missing; validity is never asserted.
    expect(component).toContain("وجود مرجع تسجيل زراعي مسجل لا يعني أن التسجيل ساري أو معتمد");
    expect(component).toContain("تبقى الجرعات والمواد المسجلة قالبًا حتى توقيع مهندس زراعي باسمه");
    expect(component).not.toMatch(/يوصى|ننصح|التوصية|الجرعة الموصى|وصفة معتمدة/);
  });

  it("labels blocked plan checks as the last recorded check", () => {
    expect(component).toContain("عوائق آخر فحص مسجل");
    expect(component).toContain("لا يحمل سجل الفحص وقتًا");
  });

  it("explains the trap follow-up fallback instead of implying a fresh check", () => {
    expect(component).toContain("يحسب العمر من آخر فحص مسجل أو من تاريخ التركيب إن لم يسجل فحص");
    expect(component).toContain("بلا فحص مسجل منذ التركيب");
  });
});
