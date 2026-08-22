import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const component = read("app/(app)/finance/dashboard/accountant-home.tsx");
const router = read("app/(app)/finance/dashboard/page.tsx");

describe("accountant home surface", () => {
  it("uses one accountant snapshot and no direct table reads", () => {
    expect(component.split('supabase.rpc("fn_accountant_home_snapshot"').length - 1).toBe(1);
    expect(component).not.toContain(".from(");
    expect(component).not.toContain("Promise.all(");
    expect(component).not.toContain("fn_finance_dashboard_snapshot");
    expect(component).toContain("parseAccountantHomeSnapshot(data, orgId, asOf, CUTOVER)");
  });

  it("routes accountants before the legacy finance client and snapshot", () => {
    const role = router.indexOf('requireRole(["owner", "accountant", "farm_manager"])');
    const branch = router.indexOf('if (m.role === "accountant") return <AccountantHome orgId={m.orgId} />');
    const client = router.indexOf("const sb = await createClient()");
    const legacy = router.indexOf('sb.rpc("fn_finance_dashboard_snapshot"');
    expect(role).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(role);
    expect(branch).toBeLessThan(client);
    expect(client).toBeLessThan(legacy);
  });

  it("shows exactly four decision KPIs and honest authority messaging", () => {
    expect(component.split("<KpiCard").length - 1).toBe(4);
    for (const label of [
      "بنود مسجلة لم تصل للدفتر",
      "مبيعات معلقة السعر",
      "دفعات مطابقة قابلة للعمل",
      "ذمم بيع مفتوحة",
    ]) expect(component).toContain(label);
    expect(component).not.toContain("قيود غير مرحلة");
    expect(component).toContain("الأرصدة والمبالغ مخفية");
    expect(component).toContain("قد يشمل العدد سجلات ناقصة الكمية");
    expect(component).toContain("مسحوبات مستبعدة");
    expect(component).toContain("capexUnpaidUnknownCount");
    expect(component).toContain('href="/custody"');
    expect(component).toContain("paymentRequestNextAction(request.status)");
    expect(component).not.toMatch(/>\s*(اعتماد الآن|تنفيذ الآن)\s*</i);
    expect(component).not.toMatch(/approvePayment|executePayment/i);
  });
});
