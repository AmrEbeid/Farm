// «أجور الفريق» — the compensation editor for SPEC-0006 slice 4.
//
// WHAT IT IS FOR. `fn_close_payroll_run` fails the ENTIRE close when any worker in the period has no
// usable rate for their resolved (person, mode[, unit]) key — deliberately, so a payroll snapshot can
// never be half-priced. Before this page there was no way to enter those rates at all: the only
// writer `people_compensation` ever had was migration 0046's one-off backfill. This is that missing
// half, and nothing else — it edits rates, it does not close periods and it moves no money.
//
// ACCESS. owner/accountant only, matching the `payroll.read` gate on `people_compensation`'s comp_rw
// policy (migrations 0046/0074) and the role set on the payroll nav entries. The nav item carries the
// same two roles, so the page never appears to someone it would redirect. Wage data is never rendered
// on any surface outside this role set.
//
// FAIL-CLOSED READS. `loadCompensationEditor` refuses on a failed read AND on an overflow rather than
// rendering a partial list — a wage list that quietly dropped rows would show a worker as unpriced
// when they are priced, and the obvious fix would then collide with the partial unique index.
//
// NO DELETE. `people_compensation` has never granted DELETE to a client (migration 0046 withheld it
// deliberately), and no delete path exists here.

import type { ReactNode } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui";
import { loadCompensationEditor } from "@/lib/compensation-read";
import { CompensationEditor } from "./editor";

export const dynamic = "force-dynamic";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const linkStyle = { border: "1px solid var(--line)", color: "var(--ink)" } as const;

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-3 py-1 text-sm" style={linkStyle}>
      {children}
    </Link>
  );
}

export default async function CompensationPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const load = await loadCompensationEditor(sb, m.orgId);
  // Attendance is a labor.write surface (owner/farm_manager/supervisor); an accountant would be
  // redirected, so only the owner is offered the link.
  const canOpenAttendance = m.role === "owner";

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">أجور الفريق</h1>
        <span className="text-xs" style={mutedStyle}>
          أجر واحد لكل عامل لكل طريقة أجر — وللأجر بالقطعة أجر لكل وحدة. تعديل الأجر لا يغيّر أي فترة
          سبق إقفالها؛ اللقطة المجمّدة لا تُعاد قراءتها أبدًا.
        </span>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <HeaderLink href="/people/payroll">إقفال الرواتب</HeaderLink>
          {canOpenAttendance && <HeaderLink href="/people/attendance">تسجيل الحضور</HeaderLink>}
        </div>
      </header>

      {!load.ok ? (
        <Alert tone="danger" title="لم تُعرض بيانات الأجور" description={load.error} />
      ) : (
        <CompensationEditor people={load.people} rows={load.rows} />
      )}
    </div>
  );
}
