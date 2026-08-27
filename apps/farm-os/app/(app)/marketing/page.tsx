import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { EmptyState, KpiCard } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { MarketingAreaNav } from "@/components/marketing/MarketingAreaNav";
import { SourceStagingPreview } from "@/components/marketing/SourceStagingPreview";
import { canAccessMarketing, loadMarketingDashboardSnapshot } from "@/lib/marketing/queries";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";

const ACTIVITY_KIND_AR: Record<string, string> = {
  call: "مكالمة",
  email: "بريد",
  meeting: "اجتماع",
  note: "ملاحظة",
  followup: "متابعة",
};

const LEAD_TYPES = ["lead_local", "lead_offshoot", "lead_social", "lead_linkedin", "hot_lead"];

export default async function MarketingOverviewPage() {
  const membership = await requireMembership();
  if (!canAccessMarketing(membership.role)) {
    return (
      <div className="p-6">
        <EmptyState
          title="هذه الصفحة لمالك المزرعة أو المحاسب أو مدير المزرعة فقط."
          description="لا تملك صلاحية الوصول إلى وحدة التسويق."
          icon="🔒"
        />
      </div>
    );
  }

  const snapshot = await loadMarketingDashboardSnapshot(membership.orgId);
  const count = (type: string) => snapshot.recordsByType[type] ?? 0;
  const leadCount = LEAD_TYPES.reduce((total, type) => total + count(type), 0);
  const marketSignalCount = count("price_observation") + count("competitor") + count("freight_reference");
  const readinessCount = count("quality_batch") + count("weekly_availability") + count("certificate");
  const openTasks = (snapshot.recordsByStatus.todo ?? 0) + (snapshot.recordsByStatus.doing ?? 0);

  const actions = [
    snapshot.overdueFollowUps > 0
      ? { tone: "danger", label: `${num(snapshot.overdueFollowUps)} متابعة متأخرة`, href: "/marketing/campaigns#contacts" }
      : null,
    snapshot.dueFollowUps7Days > 0
      ? { tone: "warning", label: `${num(snapshot.dueFollowUps7Days)} متابعة خلال ٧ أيام`, href: "/marketing/campaigns#contacts" }
      : null,
    openTasks > 0
      ? { tone: "neutral", label: `${num(openTasks)} مهمة حملة مفتوحة`, href: "/marketing/campaigns#daily-campaign" }
      : null,
    snapshot.selectedContacts === 0
      ? { tone: "warning", label: "لا توجد جهات مختارة للاتصال اليوم", href: "/marketing/campaigns#contacts" }
      : null,
  ].filter((action): action is NonNullable<typeof action> => action !== null);

  return (
    <main className="flex flex-col gap-5 p-4 sm:p-6">
      <div id="overview">
        <PageHeader title="التسويق" subtitle="من جاهزية المنتج إلى السوق، ثم العميل والمتابعة." />
      </div>

      <MarketingAreaNav />

      <section aria-label="ملخص التسويق" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/marketing/campaigns#contacts" className="no-underline">
          <KpiCard label="جهات اتصال نشطة" value={num(snapshot.activeContacts)} deltaDirection="none" />
        </Link>
        <Link href="/marketing/pipeline#crm" className="no-underline">
          <KpiCard label="فرص البيع" value={num(leadCount)} deltaDirection="none" />
        </Link>
        <Link href="/marketing/markets#daily-prices" className="no-underline">
          <KpiCard label="إشارات السوق" value={num(marketSignalCount)} deltaDirection="none" />
        </Link>
        <Link href="/marketing/product#quality" className="no-underline">
          <KpiCard label="سجلات الجاهزية" value={num(readinessCount)} deltaDirection="none" />
        </Link>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,.9fr)]">
        <div id="reports">
          <h2 className="mb-2 text-lg font-bold">مسار العمل</h2>
          <ol className="grid gap-2 sm:grid-cols-2">
            <li className="border-b pb-2" style={{ borderColor: "var(--line)" }}>
              <Link href="/marketing/product" className="font-bold">١. المنتج والجودة</Link>
              <div className="text-sm" style={{ color: "var(--ink-muted)" }}>{num(readinessCount)} سجل جاهزية</div>
            </li>
            <li className="border-b pb-2" style={{ borderColor: "var(--line)" }}>
              <Link href="/marketing/markets" className="font-bold">٢. السوق والسعر</Link>
              <div className="text-sm" style={{ color: "var(--ink-muted)" }}>{num(marketSignalCount)} إشارة قابلة للمراجعة</div>
            </li>
            <li className="border-b pb-2" style={{ borderColor: "var(--line)" }}>
              <Link href="/marketing/pipeline" className="font-bold">٣. الفرص والعروض</Link>
              <div className="text-sm" style={{ color: "var(--ink-muted)" }}>{num(leadCount)} فرصة مسجلة</div>
            </li>
            <li className="border-b pb-2" style={{ borderColor: "var(--line)" }}>
              <Link href="/marketing/campaigns" className="font-bold">٤. التواصل والمتابعة</Link>
              <div className="text-sm" style={{ color: "var(--ink-muted)" }}>{num(snapshot.selectedContacts)} جهة مختارة</div>
            </li>
          </ol>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-bold">المطلوب الآن</h2>
          {actions.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>لا توجد متابعات متأخرة أو مهام مفتوحة.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {actions.map((action) => (
                <li key={action.label}>
                  <Link
                    href={action.href}
                    className="block border-b py-2 font-bold"
                    style={{ borderColor: action.tone === "danger" ? "var(--danger)" : "var(--line)" }}
                  >
                    {action.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {snapshot.recentActivity.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-bold">آخر تواصل</h2>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {snapshot.recentActivity.slice(0, 6).map((activity) => (
              <li key={activity.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span className="font-bold">{activity.contactName} · {ACTIVITY_KIND_AR[activity.kind] ?? activity.kind}</span>
                <span style={{ color: "var(--ink-muted)" }}>{fmtDate(activity.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div id="source-import">
        <SourceStagingPreview canImport={membership.role === "owner"} />
      </div>
    </main>
  );
}
