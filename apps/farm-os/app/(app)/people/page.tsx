import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { EMP_TYPE_AR } from "@/lib/labels";

// Read-only team directory. Member-readable columns only — phone/email are PII-locked (0048) and the
// wage `rate` was moved to people_compensation (0046), so neither is selected here.
export default async function PeopleDirectoryPage() {
  await requireRole(["owner", "farm_manager", "agri_engineer", "accountant"]);
  const sb = await createClient();

  const { data: people, error } = await sb
    .from("people")
    .select("id, name, position, employment_type, active, reports_to_person_id")
    .order("name");
  if (error) throw error;

  const nameById = new Map((people ?? []).map((p) => [p.id, p.name]));

  const columns: SimpleColumn[] = [
    { id: "name", header: "الاسم" },
    { id: "position", header: "الوظيفة" },
    { id: "type", header: "نوع التوظيف" },
    { id: "manager", header: "يتبع" },
    { id: "active", header: "نشط", kind: "tag-ok" },
  ];

  const rows = (people ?? []).map((p) => ({
    id: p.id,
    href: `/people/${p.id}`,
    name: p.name,
    position: p.position ?? "—",
    type: p.employment_type ? EMP_TYPE_AR[p.employment_type] ?? "غير معروف" : "—",
    manager: p.reports_to_person_id
      ? nameById.get(p.reports_to_person_id) ?? "—"
      : "—",
    active: p.active ? "نشط" : "",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">الفريق</h1>
        <p style={{ color: "var(--ink-muted)" }}>دليل العاملين بالمزرعة</p>
      </header>
      <FilterableTable
        ariaLabel="الفريق"
        columns={columns}
        rows={rows}
        empty="لا يوجد عاملون مسجّلون"
        searchColumns={["name", "position"]}
        placeholder="ابحث عن عامل…"
        exportFilename="people"
      />
    </div>
  );
}
