// «تسجيل الحضور» — ACTUAL day-to-day labor capture (SPEC-0006 slice 2, made mode-aware for the
// slice-3 payroll kernel, migration 20260729090000_payroll_run_persistence.sql).
//
// ACCESS. `labor.write` roles — owner/farm_manager/supervisor (migration 20260701300000) — the same
// set that runs field crews day to day. The server action re-establishes the identical gate from the
// session, and `labor_logs.tenant_all`'s WITH CHECK re-enforces it in Postgres.
//
// NO WAGE DATA, EVER. `labor_logs` carries the SHAPE of the work (hours, and for piece rows a
// quantity + unit) and never a rate. Rates live in the payroll.read-gated `people_compensation`,
// which this page does not read — a supervisor can log a per-box day without ever learning what a
// box is worth. The «أجور الفريق» link below is rendered ONLY for the owner, the one role that holds
// both labor.write and payroll.read.
//
// BOUNDED READS. The team list and the recent-rows list are both fetched with an explicit LIMIT and
// scoped to the SERVER session's active org (defence-in-depth on top of RLS).

import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { LaborLogForm } from "@/components/LaborLogForm";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { cairoTodayIso } from "@/lib/payroll-close";
import { laborModeLabel, laborUnitLabel } from "@/lib/labor-entry";

export const dynamic = "force-dynamic";

/** The team picker is a picker, not an archive browser. */
const ATTENDANCE_PEOPLE_LIMIT = 400;
/** Recent rows only — the full history lives in the payroll report for a closed period. */
const ATTENDANCE_LOG_LIMIT = 30;

const mutedStyle = { color: "var(--ink-muted)" } as const;
const linkStyle = { border: "1px solid var(--line)", color: "var(--ink)" } as const;

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-3 py-1 text-sm" style={linkStyle}>
      {children}
    </Link>
  );
}

export default async function AttendancePage() {
  const m = await requireRole(["owner", "farm_manager", "supervisor"]);
  const sb = await createClient();
  // Only the owner holds BOTH labor.write (this page) and payroll.read (the wage surfaces), so only
  // the owner is offered a link into them. A farm_manager/supervisor would be redirected.
  const canOpenPayroll = m.role === "owner";

  const [
    { data: people, error: peopleError },
    { data: logs, error: logsError },
  ] = await Promise.all([
    sb
      .from("people")
      .select("id, name")
      .eq("org_id", m.orgId)
      .eq("active", true)
      .order("name")
      .limit(ATTENDANCE_PEOPLE_LIMIT),
    sb
      .from("labor_logs")
      .select("id, work_date, hours, mode, quantity, unit, note, team_name, people(name)")
      .eq("org_id", m.orgId)
      .order("work_date", { ascending: false })
      .limit(ATTENDANCE_LOG_LIMIT),
  ]);
  if (peopleError) throw peopleError;
  if (logsError) throw logsError;

  const columns: SimpleColumn[] = [
    { id: "who", header: "من" },
    { id: "work_date", header: "التاريخ" },
    { id: "mode", header: "طريقة الأجر" },
    { id: "hours", header: "الساعات", numeric: true },
    { id: "quantity", header: "الكمية", numeric: true },
    { id: "unit", header: "الوحدة" },
    { id: "note", header: "ملاحظات" },
  ];

  const rows = (logs ?? []).map((l) => {
    const person = l.people as { name?: string | null } | null;
    return {
      id: l.id,
      who: person?.name ?? l.team_name ?? "—",
      work_date: l.work_date ? fmtDate(l.work_date) : "—",
      mode: laborModeLabel(l.mode ?? "hourly"),
      hours: num(l.hours ?? 0, 1),
      quantity: l.quantity == null ? "—" : num(Number(l.quantity), 2),
      unit: laborUnitLabel(l.unit ?? null),
      note: l.note ?? "—",
    };
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">تسجيل الحضور</h1>
        <span className="text-xs" style={mutedStyle}>
          حضور يوم عمل واحد لعضو فريق أو فريق غير مسجّل. لا تظهر هنا أي أجور أو معدلات.
        </span>
        {canOpenPayroll && (
          <div className="no-print ms-auto flex flex-wrap items-center gap-2">
            <HeaderLink href="/people/payroll/compensation">أجور الفريق</HeaderLink>
            <HeaderLink href="/people/payroll">إقفال الرواتب</HeaderLink>
          </div>
        )}
      </header>

      <LaborLogForm
        people={(people ?? []).map((p) => ({ id: p.id, name: p.name }))}
        todayIso={cairoTodayIso()}
      />

      <Card title={`آخر ${num(ATTENDANCE_LOG_LIMIT)} سجل`}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد سجلات حضور بعد" />
        ) : (
          <SimpleTable columns={columns} rows={rows} ariaLabel="آخر سجلات الحضور" empty="—" />
        )}
      </Card>
    </div>
  );
}
