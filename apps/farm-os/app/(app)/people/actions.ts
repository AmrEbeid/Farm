"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { EMP_TYPE_AR } from "@/lib/labels";
import {
  LABOR_WRITE_MESSAGE_AR,
  laborWriteFailure,
  parseLaborLogInput,
} from "@/lib/labor-entry";
import { isUuid } from "@/lib/uuid";

const NO_PEOPLE_PERM = "ليس لديك صلاحية إضافة أو تعديل أعضاء الفريق";

export interface PersonInput {
  name: string;
  position: string | null;
  employmentType: string | null;
  reportsToPersonId: string | null;
  active: boolean;
}

/**
 * Onboard a new team member (SPEC-0006). RLS (`people.tenant_all` WITH CHECK, migration
 * 20260701300000) re-enforces `authorize('people.write', org_id)` server-side — owner/farm_manager
 * only, mirroring the sibling `responsibility_assignments` write gate. The existing
 * `people_reports_to_same_org` trigger (migration 0071) rejects a cross-org manager. Direct-REST
 * insert (no RPC): the RLS gate + trigger already make it safe, matching the `suppliers` precedent.
 */
export async function createPerson(input: PersonInput): Promise<{ ok: boolean; error?: string }> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "اسم عضو الفريق مطلوب" };
  if (input.employmentType && !(input.employmentType in EMP_TYPE_AR)) {
    return { ok: false, error: "نوع التوظيف غير صالح" };
  }

  const m = await requireMembership();
  const sb = await createClient();
  const { error } = await sb.from("people").insert({
    org_id: m.orgId,
    name,
    position: input.position?.trim() || null,
    employment_type: input.employmentType || null,
    reports_to_person_id: input.reportsToPersonId || null,
    active: input.active,
  });
  if (error) {
    // 42501 covers both the RLS people.write gate and the people_reports_to_same_org trigger
    // (migration 0071), which raises the same SQLSTATE for a cross-org manager.
    return { ok: false, error: toArabicError(error, { "42501": NO_PEOPLE_PERM }) };
  }
  revalidatePath("/people");
  revalidatePath("/people/dashboard");
  return { ok: true };
}

export interface LaborLogInput {
  personId: string | null;
  teamName: string | null;
  /** Wage mode (#388): hourly | daily | piece | seasonal. */
  mode: string;
  workDate: string;
  hours: number | string;
  /** Piece rows only — null for every other mode (labor_logs_piece_shape). */
  quantity: number | string | null;
  /** Piece rows only — null for every other mode (labor_logs_piece_shape). */
  unit: string | null;
  note: string | null;
}

/**
 * Log a day's attendance/labor (SPEC-0006 slice 2 — ACTUAL day-to-day labor, distinct from PLANNED
 * `plan_labor_requirements`), now MODE-AWARE for the slice-3 payroll kernel.
 *
 * AUTHORIZATION FIRST. A server action is a public endpoint: `requireRole` runs BEFORE the input is
 * even looked at, so an unauthenticated or wrong-role caller is redirected rather than answered with
 * a validation verdict that tells them their payload was well-formed enough to reach the next check.
 * The role set (owner/farm_manager/supervisor) matches the `labor.write` gate that
 * `labor_logs.tenant_all`'s WITH CHECK re-enforces in Postgres — the UI gate is the outer layer,
 * never the only one.
 *
 * SESSION ORG ONLY. `org_id` is `m.orgId` and nothing else. No org ever arrives from the client, so
 * a forged field cannot aim this write at another tenant; RLS would reject it anyway.
 *
 * NO WAGE IS WRITTEN HERE. `labor_logs` carries mode/quantity/unit — the SHAPE of the work — and
 * never a rate. Rates stay in the payroll.read-gated `people_compensation`, and the two only ever
 * meet inside `fn_close_payroll_run`.
 *
 * NO RAW DB TEXT. Failures — including `guard_labor_log_payroll_freeze`'s closed-period 55000 — are
 * mapped to the fixed Arabic constants in LABOR_WRITE_MESSAGE_AR (non-negotiable #2).
 */
export async function createLaborLog(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const m = await requireRole(["owner", "farm_manager", "supervisor"]);
  if (!isUuid(m.orgId)) return { ok: false, error: LABOR_WRITE_MESSAGE_AR.general };

  const parsed = parseLaborLogInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const entry = parsed.value;

  const sb = await createClient();
  const { error } = await sb.from("labor_logs").insert({
    org_id: m.orgId,
    person_id: entry.personId,
    team_name: entry.teamName,
    work_date: entry.workDate,
    hours: entry.hours,
    mode: entry.mode,
    quantity: entry.quantity,
    unit: entry.unit,
    note: entry.note,
  });
  if (error) return { ok: false, error: laborWriteFailure(error).message };

  revalidatePath("/people/attendance");
  revalidatePath("/people/dashboard");
  return { ok: true };
}
