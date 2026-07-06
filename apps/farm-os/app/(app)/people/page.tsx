import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { PeopleDirectoryGrouped, type PersonGroup, type PersonRow } from "@/components/PeopleDirectoryGrouped";
import { PersonCreateForm } from "@/components/PersonCreateForm";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PrintButton } from "@/components/print-button";
import { num } from "@/lib/money";
import { EMP_TYPE_AR } from "@/lib/labels";

const NO_MANAGER_GROUP_ID = undefined;

type PeopleFilter = "all" | "active" | "assigned";

function parsePeopleFilter(raw: string | undefined): PeopleFilter {
  return raw === "active" || raw === "assigned" ? raw : "all";
}

// Team directory, grouped one level by direct manager (reports_to_person_id) instead of a
// flat list — "فريق <المدير>" sections, collapsible — PLUS an onboarding form (SPEC-0006 — gated to
// people.write roles: owner/farm_manager, migration 20260701300000). Member-readable columns only —
// phone/email are PII-locked (0048) and the wage `rate` lives in people_compensation (0046), so
// neither is selected here.
const PEOPLE_WRITE_ROLES = ["owner", "farm_manager"];
export default async function PeopleDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const m = await requireRole(["owner", "farm_manager", "agri_engineer", "accountant"]);
  const sb = await createClient();
  const filter = parsePeopleFilter((await searchParams).filter);

  const [{ data: people, error }, { data: assigneeRows, error: assigneeError }] = await Promise.all([
    sb.from("people").select("id, name, position, employment_type, active, reports_to_person_id").order("name"),
    // Open workload: assignees on operations still in `planned` (the only pre-done state the
    // app can produce today — see OPS-360). Person-level count, not hours (labor hours aren't
    // linked to ops yet — LINKAGE-MAP gap #6/#3; we don't fabricate a workload number).
    sb
      .from("plan_operation_assignees")
      .select("person_id, plan_operations!inner(status)")
      .eq("plan_operations.status", "planned"),
  ]);
  if (error) throw error;
  if (assigneeError) throw assigneeError;

  const all = people ?? [];
  const openAssignments = new Map<string, number>();
  for (const row of assigneeRows ?? []) {
    if (!row.person_id) continue;
    openAssignments.set(row.person_id, (openAssignments.get(row.person_id) ?? 0) + 1);
  }

  const chips: { key: PeopleFilter; label: string; value: number }[] = [
    { key: "all", label: "كل الفريق", value: all.length },
    { key: "active", label: "نشطون", value: all.filter((p) => p.active).length },
    { key: "assigned", label: "مكلّفون بعمليات مفتوحة", value: all.filter((p) => openAssignments.has(p.id)).length },
  ];

  const nameById = new Map(all.map((p) => [p.id, p.name]));
  // Only people who are someone's manager get their own section — computed from the real
  // reports_to_person_id values present, not fabricated from a role/title.
  const managerIds = new Set(all.map((p) => p.reports_to_person_id).filter((id): id is string => id != null));
  const canWrite = PEOPLE_WRITE_ROLES.includes(m.role);
  const activeManagers = all.filter((p) => p.active);

  const columns: SimpleColumn[] = [
    { id: "name", header: "الاسم" },
    { id: "position", header: "الوظيفة" },
    { id: "type", header: "نوع التوظيف" },
    { id: "manager", header: "يتبع" },
    { id: "open_ops", header: "تكليفات مفتوحة", numeric: true },
    { id: "active", header: "نشط", kind: "tag-ok" },
  ];

  // One-level grouping: a person's group is their direct manager, if that manager still exists in
  // the org; everyone else (no manager, or a dangling reports_to) falls into the catch-all. A person
  // who is themselves a manager still appears here as a row under THEIR OWN manager's group (or the
  // catch-all) — they separately get their own section header below for their direct reports.
  const groupIdFor = (p: (typeof all)[number]): string | undefined =>
    p.reports_to_person_id && nameById.has(p.reports_to_person_id) ? p.reports_to_person_id : NO_MANAGER_GROUP_ID;

  const visible = all.filter((p) =>
    filter === "active" ? p.active : filter === "assigned" ? openAssignments.has(p.id) : true,
  );

  const rows: PersonRow[] = visible.map((p) => ({
    id: p.id,
    href: `/people/${p.id}`,
    groupId: groupIdFor(p),
    name: p.name,
    position: p.position ?? "—",
    type: p.employment_type ? EMP_TYPE_AR[p.employment_type] ?? "غير معروف" : "—",
    manager: p.reports_to_person_id ? nameById.get(p.reports_to_person_id) ?? "—" : "—",
    open_ops: num(openAssignments.get(p.id) ?? 0),
    active: p.active ? "نشط" : "",
  }));

  // Section order: managers by name (matches the overall list order), catch-all last.
  const groups: PersonGroup[] = [
    ...all.filter((p) => managerIds.has(p.id)).map((p): PersonGroup => ({ id: p.id, label: `فريق ${p.name}` })),
    { id: NO_MANAGER_GROUP_ID, label: "بدون مدير مباشر" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الفريق</h1>
          <p style={{ color: "var(--ink-muted)" }}>دليل العاملين بالمزرعة</p>
        </div>
        <PrintButton label="طباعة الفريق" />
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {chips.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/people" : `/people?filter=${chip.key}`}
            active={filter === chip.key}
          >
            <KpiCard label={chip.label} value={num(chip.value)} deltaDirection="none" />
          </DashboardKpiLink>
        ))}
      </div>

      {canWrite && (
        <div className="no-print">
          <PersonCreateForm managers={activeManagers} />
        </div>
      )}
      <PeopleDirectoryGrouped
        ariaLabel="الفريق"
        columns={columns}
        rows={rows}
        groups={groups}
        empty={filter === "all" ? "لا يوجد عاملون مسجّلون" : "لا أحد يطابق هذا الفلتر"}
        searchColumns={["name", "position"]}
        placeholder="ابحث عن عامل…"
        exportFilename="people"
      />
    </div>
  );
}
