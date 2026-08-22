import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const component = read("app/(app)/dashboard/manager/manager-home.tsx");
const router = read("app/(app)/dashboard/manager/page.tsx");

describe("manager home surface", () => {
  it("uses one bounded manager snapshot and no direct table reads", () => {
    expect(component.split('supabase.rpc("fn_manager_home_snapshot"').length - 1).toBe(1);
    expect(component).not.toContain(".from(");
    expect(component).not.toContain("Promise.all(");
    expect(component).toContain("parseManagerHomeSnapshot(data, orgId, asOf)");
  });

  it("routes the agronomist first and keeps the manager branch on its own snapshot", () => {
    const role = router.indexOf('requireRole(["farm_manager", "agri_engineer"])');
    const agronomist = router.indexOf('if (m.role === "agri_engineer") return <AgronomistHome orgId={m.orgId} />');
    const manager = router.indexOf("return <ManagerHome orgId={m.orgId} />");
    expect(role).toBeGreaterThan(-1);
    expect(agronomist).toBeGreaterThan(role);
    expect(manager).toBeGreaterThan(agronomist);
  });

  it("keeps no legacy unbounded reads on the shared route", () => {
    expect(router).not.toContain("createClient");
    expect(router).not.toContain(".from(");
    expect(router).not.toContain("est_cost");
    expect(router).not.toContain("FilterableTable");
  });

  it("shows exactly four operational KPIs and no absolute finance", () => {
    expect(component.split("<KpiCard").length - 1).toBe(4);
    for (const label of ["عمليات اليوم المفتوحة", "عمليات متأخرة", "تنتظر توقيعًا زراعيًا", "تحت حد إعادة الطلب"]) {
      expect(component).toContain(label);
    }
    expect(component).toContain('href="/record/plan"');
    expect(component).toContain('href="/record/activity"');
    expect(component).toContain("إشارة لحظية مقابل حد إعادة الطلب");
    expect(component).toContain("عوائق آخر فحص مسجل");
    expect(component).toContain("حالته غير معروفة");
    expect(component).not.toMatch(/est_cost|egpExact|قيمة مالية|إجمالي التكلفة/i);
  });

  it("shows exact recorded counts instead of dashes when the source is only partial", () => {
    // R3d: a partial operations/inventory authority must not blank a count the organisation recorded.
    expect(component).not.toContain('"—"');
    expect(component).toContain('const recordedOnly = operationsVerified && inventoryVerified ? "" : " · المسجل فقط";');
    for (const value of [
      "value={num(snapshot.state.operations.todayCount)}",
      "value={num(snapshot.state.operations.overdueCount)}",
      "value={num(snapshot.state.pendingAgronomySignoffs)}",
      "value={num(snapshot.state.inventory.belowThresholdCount)}",
    ]) {
      expect(component).toContain(value);
    }
    expect(component).toContain("الأرقام هنا مسجلة فقط، وتغطية المصدر غير مؤكدة");
  });

  it("still gates every completeness or all-clear claim on verified authority", () => {
    expect(component).toContain("attention.length > 0 || (operationsVerified && inventoryVerified)");
    expect(component).toContain('operationsVerified && inventoryVerified ? "لا توجد أعمال أو عوائق تحتاج قرارا الآن"');
    expect(component).toContain("لا توجد بنود مسجلة للمتابعة الآن");
    // A green "all good" direction is only claimed when the source is verified.
    expect(component).not.toMatch(/> 0 \? "down" : "up"\s*\}/);
  });
});
