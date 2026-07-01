import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { type SimpleColumn } from "@/components/SimpleTable";
import { PeopleDirectoryGrouped, type PersonGroup, type PersonRow } from "@/components/PeopleDirectoryGrouped";
import { PersonCreateForm } from "@/components/PersonCreateForm";
import { EMP_TYPE_AR } from "@/lib/labels";

const NO_MANAGER_GROUP_ID = undefined;

// Team directory, grouped one level by direct manager (reports_to_person_id) instead of a
// flat list — "فريق <المدير>" sections, collapsible — PLUS an onboarding form (SPEC-0006 — gated to
// people.write roles: owner/farm_manager, migration 20260701300000). Member-readable columns only —
// phone/email are PII-locked (0048) and the wage `rate` lives in people_compensation (0046), so
// neither is selected here.
const PEOPLE_WRITE_ROLES = ["owner", "farm_manager"];
export default async function PeopleDirectoryPage() {
  const m = await requireRole(["owner", "farm_manager", "agri_engineer", "accountant"]);
  const sb = await createClient();

  const { data: people, error } = await sb
    .from("people")
    .select("id, name, position, employment_type, active, reports_to_person_id")
    .order("name");
  if (error) throw error;

  const all = people ?? [];
  const nameById = new Map(all.map((p) => [p.id, p.name]));
  // Only people who are someone's manager get their own section — computed from the real
  // reports_to_person_id values present, not fabricated from a role/title.
  const managerIds = new Set(
    all.map((p) => p.reports_to_person_id).filter((id): id is string => id != null),
  );
  const canWrite = PEOPLE_WRITE_ROLES.includes(m.role);
  const activeManagers = all.filter((p) => p.active);

  const columns: SimpleColumn[] = [
    { id: "name", header: "الاسم" },
    { id: "position", header: "الوظيفة" },
    { id: "type", header: "نوع التوظيف" },
    { id: "manager", header: "يتبع" },
    { id: "active", header: "نشط", kind: "tag-ok" },
  ];

  // One-level grouping: a person's group is their direct manager, if that manager still exists in
  // the org; everyone else (no manager, or a dangling reports_to) falls into the catch-all. A person
  // who is themselves a manager still appears here as a row under THEIR OWN manager's group (or the
  // catch-all) — they separately get their own section header below for their direct reports.
  const groupIdFor = (p: (typeof all)[number]): string | undefined =>
    p.reports_to_person_id && nameById.has(p.reports_to_person_id) ? p.reports_to_person_id : NO_MANAGER_GROUP_ID;

  const rows: PersonRow[] = all.map((p) => ({
    id: p.id,
    href: `/people/${p.id}`,
    groupId: groupIdFor(p),
    name: p.name,
    position: p.position ?? "—",
    type: p.employment_type ? EMP_TYPE_AR[p.employment_type] ?? "غير معروف" : "—",
    manager: p.reports_to_person_id
      ? nameById.get(p.reports_to_person_id) ?? "—"
      : "—",
    active: p.active ? "نشط" : "",
  }));

  // Section order: managers by name (matches the overall list order), catch-all last.
  const groups: PersonGroup[] = [
    ...all
      .filter((p) => managerIds.has(p.id))
      .map((p): PersonGroup => ({ id: p.id, label: `فريق ${p.name}` })),
    { id: NO_MANAGER_GROUP_ID, label: "بدون مدير مباشر" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">الفريق</h1>
        <p style={{ color: "var(--ink-muted)" }}>دليل العاملين بالمزرعة</p>
      </header>
      {canWrite && <PersonCreateForm managers={activeManagers} />}
      <PeopleDirectoryGrouped
        ariaLabel="الفريق"
        columns={columns}
        rows={rows}
        groups={groups}
        empty="لا يوجد عاملون مسجّلون"
        searchColumns={["name", "position"]}
        placeholder="ابحث عن عامل…"
        exportFilename="people"
      />
    </div>
  );
}
