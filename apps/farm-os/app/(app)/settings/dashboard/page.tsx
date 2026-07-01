import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs, requireMembership, ROLE_LABEL_AR, type Role } from "@/lib/auth";
import { Card, DescriptionList, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { CategoryDoughnut } from "@/components/charts";
import { num } from "@/lib/money";

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل الأقسام",
  org: "بيانات المؤسسة",
  roles: "توزيع الأدوار",
  links: "روابط الإدارة",
};

export default async function SettingsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "all" } = await searchParams;
  const membership = await requireMembership();
  const sb = await createClient();
  const orgs = await getUserOrgs();
  const canEditSettings = membership.role === "owner";

  const [
    { data: org, error: orgError },
    { data: people, error: peopleError },
    { data: members, error: membersError },
  ] = await Promise.all([
    sb
      .from("organization")
      .select("id, name, locale, currency, area_unit, fiscal_year_start")
      .eq("id", membership.orgId)
      .maybeSingle(),
    sb
      .from("people")
      .select("id, active")
      .eq("org_id", membership.orgId)
      .order("created_at", { ascending: false }),
    sb
      .from("organization_member")
      .select("role")
      .eq("org_id", membership.orgId),
  ]);
  if (orgError) throw orgError;
  if (peopleError) throw peopleError;
  if (membersError) throw membersError;

  const activePeople = (people ?? []).filter((p) => p.active).length;
  const roleCounts = (members ?? []).reduce<Record<string, number>>((acc, member) => {
    const role = member.role ?? "unknown";
    acc[role] = (acc[role] ?? 0) + 1;
    return acc;
  }, {});

  const roleColumns: SimpleColumn[] = [
    { id: "role", header: "الدور" },
    { id: "count", header: "العدد", numeric: true },
  ];
  const roleRows = Object.entries(roleCounts).map(([role, count]) => ({
    id: role,
    role: ROLE_LABEL_AR[role as Role] ?? "غير معروف",
    count: num(count),
  }));
  // Chart data — role distribution from the members already fetched (no new query).
  const roleMix = Object.entries(roleCounts).map(([role, value]) => ({
    name: ROLE_LABEL_AR[role as Role] ?? "غير معروف",
    value,
  }));

  const linkColumns: SimpleColumn[] = [
    { id: "page", header: "الصفحة" },
    { id: "scope", header: "الاستخدام" },
  ];
  const linkRows = [
    { id: "profile", href: "/profile", page: "الملف الشخصي", scope: "هويتك ودورك والمؤسسة النشطة" },
    ...(canEditSettings
      ? [{ id: "settings", href: "/settings", page: "إعدادات المؤسسة", scope: "اسم المؤسسة والعملة والسنة المالية" }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة الإدارة</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            ملخص المؤسسة والدور الحالي وروابط الإدارة المتاحة لك.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/profile">الملف الشخصي</HeaderLink>
          {canEditSettings && <HeaderLink href="/settings">إعدادات المؤسسة</HeaderLink>}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink href="/settings/dashboard?filter=org" active={filter === "org"}>
          <KpiCard label="مؤسسات متاحة" value={num(orgs.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/settings/dashboard?filter=roles" active={filter === "roles"}>
          <KpiCard label="دورك" value={ROLE_LABEL_AR[membership.role]} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/settings/dashboard?filter=roles" active={filter === "roles"}>
          <KpiCard label="أعضاء نشطون" value={num(activePeople)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/settings/dashboard?filter=links" active={filter === "links"}>
          <KpiCard label="تعديل الإعدادات" value={canEditSettings ? "متاح" : "غير متاح"} />
        </DashboardKpiLink>
      </section>

      <CurrentFilterCard
        label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
        clearHref="/settings/dashboard"
        showClear={filter !== "all"}
      />

      {(filter === "all" || filter === "org" || filter === "roles") && (
        <section className="grid gap-4 xl:grid-cols-2">
          {(filter === "all" || filter === "org") && (
        <Card title="بيانات المؤسسة">
          <DescriptionList
            layout="inline"
            items={[
              { id: "name", term: "الاسم", description: org?.name ?? "—" },
              { id: "locale", term: "اللغة", description: org?.locale ?? "—" },
              { id: "currency", term: "العملة", description: org?.currency ?? "—" },
              { id: "area", term: "وحدة المساحة", description: org?.area_unit ?? "—" },
              { id: "fiscal", term: "بداية السنة المالية", description: org?.fiscal_year_start ?? "—" },
            ]}
          />
        </Card>
          )}
          {(filter === "all" || filter === "roles") && (
        <Card title="توزيع الأدوار">
          {roleMix.length > 0 && (
            <div className="mb-4">
              <CategoryDoughnut
                data={roleMix}
                ariaLabel="توزيع الأعضاء حسب الدور"
                caption="توزيع الأدوار"
                labelHeader="الدور"
                valueHeader="العدد"
              />
            </div>
          )}
          <SimpleTable columns={roleColumns} rows={roleRows} ariaLabel="توزيع الأدوار" empty="لا توجد عضويات" />
        </Card>
          )}
        </section>
      )}

      {(filter === "all" || filter === "links") && (
        <Card title="روابط الإدارة">
          <SimpleTable columns={linkColumns} rows={linkRows} ariaLabel="روابط الإدارة" empty="لا توجد روابط" />
        </Card>
      )}
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
