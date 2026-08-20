import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { KpiCard, EmptyState } from "@/components/ui";
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { SourceStagingPreview } from "@/components/marketing/SourceStagingPreview";
import { canAccessMarketing, loadMarketingRecords, loadMarketingContacts, loadMarketingContactActivity } from "@/lib/marketing/queries";
import type { MarketingRecordType } from "@/lib/database.types.ext";

const ALL_TYPES: MarketingRecordType[] = [
  "price_observation",
  "exw_bid",
  "quality_batch",
  "weekly_availability",
  "competitor",
  "lead_local",
  "lead_offshoot",
  "lead_social",
  "lead_linkedin",
  "hot_lead",
  "task",
  "platform_state",
  "broker_state",
  "certificate",
  "channel_target",
  "message_template",
];

/**
 * SPEC-0032 — Marketing module Overview (dashboard-first). Consolidates the 25 legacy tracking
 * areas into 5 nav pages; this is the landing page: KPI counts across every record type, follow-ups
 * due soon, and links to the other 4 views. Owner/accountant/farm_manager only (RLS also enforces
 * this — a direct URL hit by another role sees this notice, not an empty table).
 */
export default async function MarketingOverviewPage() {
  const m = await requireMembership();
  if (!canAccessMarketing(m.role)) {
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

  const [records, contacts, activity] = await Promise.all([
    loadMarketingRecords(m.orgId, ALL_TYPES),
    loadMarketingContacts(m.orgId),
    loadMarketingContactActivity(m.orgId),
  ]);

  const active = records.filter((r) => !r.archived);
  const activeContacts = contacts.filter((c) => !c.archived);
  const in7Days = new Date().getTime() + 7 * 24 * 60 * 60 * 1000;
  const dueFollowUps = activity
    .filter((a) => a.followUpAt && new Date(a.followUpAt).getTime() <= in7Days)
    .sort((a, b) => (a.followUpAt! < b.followUpAt! ? -1 : 1));

  const kpis = [
    { label: "جهات اتصال نشطة", value: activeContacts.length, href: "/marketing/campaigns" },
    { label: "جهات مختارة (شورت-ليست)", value: activeContacts.filter((c) => c.selected).length, href: "/marketing/campaigns" },
    { label: "سجلات نشطة (كل الأنواع)", value: active.length, href: "/marketing/pipeline" },
    { label: "متابعات مستحقة خلال ٧ أيام", value: dueFollowUps.length, href: "/marketing/campaigns" },
  ];

  const views = [
    { href: "/marketing/product", label: "المنتج", desc: "جودة الدفعات والكميات الأسبوعية المتاحة." },
    { href: "/marketing/markets", label: "الأسواق", desc: "رصد الأسعار والمنافسين والكويت." },
    { href: "/marketing/pipeline", label: "خط المبيعات", desc: "العملاء المحتملون وعروض EXW والوسطاء." },
    { href: "/marketing/campaigns", label: "الحملات", desc: "جهات الاتصال والمهام والمنصّات والقوالب." },
  ];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">التسويق</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          نظرة عامة على تسويق التصدير: الأسعار، خط المبيعات، جهات الاتصال، والحملات — بديل مُوحّد لملفات المتابعة القديمة.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="no-underline">
            <KpiCard label={k.label} value={num(k.value)} deltaDirection="none" />
          </Link>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {views.map((v) => (
          <Link
            key={v.href}
            href={v.href}
            className="rounded-lg border p-4 no-underline"
            style={{ borderColor: "var(--line)", color: "inherit" }}
          >
            <div className="text-lg font-bold">{v.label}</div>
            <div style={{ color: "var(--ink-muted)" }}>{v.desc}</div>
          </Link>
        ))}
      </section>

      {dueFollowUps.length > 0 && (
        <section className="rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
          <h2 className="mb-2 text-lg font-bold">متابعات مستحقة قريبًا</h2>
          <ul className="flex flex-col gap-1">
            {dueFollowUps.slice(0, 10).map((a) => {
              const c = contacts.find((x) => x.id === a.contactId);
              return (
                <li key={a.id}>
                  {c?.name ?? "جهة اتصال"} — {fmtDate(a.followUpAt!)}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <SourceStagingPreview orgId={m.orgId} canWrite />
    </div>
  );
}
