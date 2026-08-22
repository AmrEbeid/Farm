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

  it("routes farm managers before the preserved agronomist reads", () => {
    const role = router.indexOf('requireRole(["farm_manager", "agri_engineer"])');
    const branch = router.indexOf('if (m.role === "farm_manager") return <ManagerHome orgId={m.orgId} />');
    const client = router.indexOf("const sb = await createClient()");
    expect(role).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(role);
    expect(branch).toBeLessThan(client);
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
});
