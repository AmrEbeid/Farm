import { KpiCard } from "@/components/ui";
import { num } from "@/lib/money";
import type { MarketingDashboardSnapshot } from "@/lib/marketing/queries";

const LEAD_TYPES = ["lead_local", "lead_offshoot", "lead_social", "lead_linkedin", "hot_lead"];

/** SPEC-0032 — dashboard tab "مؤشرات التسويق"; same figures as the compact overview page. */
export function WorkspaceKpiPanel({ snapshot }: { snapshot: MarketingDashboardSnapshot }) {
  const count = (type: string) => snapshot.recordsByType[type] ?? 0;
  const leadCount = LEAD_TYPES.reduce((total, type) => total + count(type), 0);
  const marketSignalCount = count("price_observation") + count("competitor") + count("freight_reference");
  const readinessCount = count("quality_batch") + count("weekly_availability") + count("certificate");
  const openTasks = (snapshot.recordsByStatus.todo ?? 0) + (snapshot.recordsByStatus.doing ?? 0);

  return (
    <section aria-label="مؤشرات التسويق" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="جهات اتصال نشطة" value={num(snapshot.activeContacts)} deltaDirection="none" />
      <KpiCard label="جهات مختارة اليوم" value={num(snapshot.selectedContacts)} deltaDirection="none" />
      <KpiCard label="فرص البيع" value={num(leadCount)} deltaDirection="none" />
      <KpiCard label="إشارات السوق" value={num(marketSignalCount)} deltaDirection="none" />
      <KpiCard label="سجلات الجاهزية" value={num(readinessCount)} deltaDirection="none" />
      <KpiCard label="مهام مفتوحة" value={num(openTasks)} deltaDirection="none" />
      <KpiCard label="متابعات متأخرة" value={num(snapshot.overdueFollowUps)} deltaDirection={snapshot.overdueFollowUps > 0 ? "down" : "none"} />
      <KpiCard label="متابعات خلال ٧ أيام" value={num(snapshot.dueFollowUps7Days)} deltaDirection="none" />
    </section>
  );
}
