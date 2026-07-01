import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { LaborLogForm } from "@/components/LaborLogForm";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";

/**
 * Attendance / labor-log capture (SPEC-0006 slice 2 — ACTUAL day-to-day labor, distinct from the
 * PLANNED `plan_labor_requirements`). Gated to `labor.write` roles (owner/farm_manager/supervisor,
 * migration 20260701300000) — the same set that runs field crews day to day. `labor_logs` carries no
 * wage/rate; hours only (SPEC-0006 confidentiality — rate stays in `people_compensation`).
 */
export default async function AttendancePage() {
  await requireRole(["owner", "farm_manager", "supervisor"]);
  const sb = await createClient();

  const [
    { data: people, error: peopleError },
    { data: logs, error: logsError },
  ] = await Promise.all([
    sb.from("people").select("id, name").eq("active", true).order("name"),
    sb
      .from("labor_logs")
      .select("id, work_date, hours, note, team_name, people(name)")
      .order("work_date", { ascending: false })
      .limit(30),
  ]);
  if (peopleError) throw peopleError;
  if (logsError) throw logsError;

  const columns: SimpleColumn[] = [
    { id: "who", header: "من" },
    { id: "work_date", header: "التاريخ" },
    { id: "hours", header: "الساعات", numeric: true },
    { id: "note", header: "ملاحظات" },
  ];

  const rows = (logs ?? []).map((l) => {
    const person = l.people as { name?: string | null } | null;
    return {
      id: l.id,
      who: person?.name ?? l.team_name ?? "—",
      work_date: l.work_date ? fmtDate(l.work_date) : "—",
      hours: num(l.hours ?? 0, 1),
      note: l.note ?? "—",
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">تسجيل الحضور</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          سجّل حضور عضو فريق أو فريق غير مسجّل ليوم عمل واحد. لا تظهر هنا أي أجور أو معدلات.
        </p>
      </header>

      <LaborLogForm people={(people ?? []).map((p) => ({ id: p.id, name: p.name }))} />

      <Card title="آخر السجلات">
        {rows.length === 0 ? (
          <EmptyState title="لا توجد سجلات حضور بعد" />
        ) : (
          <SimpleTable columns={columns} rows={rows} ariaLabel="آخر سجلات الحضور" empty="—" />
        )}
      </Card>
    </div>
  );
}
