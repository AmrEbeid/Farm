"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { EMP_TYPE_AR } from "@/lib/labels";

const NO_PEOPLE_PERM = "ليس لديك صلاحية إضافة أو تعديل أعضاء الفريق";
const NO_LABOR_PERM = "ليس لديك صلاحية تسجيل الحضور";

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
  workDate: string;
  hours: number;
  note: string | null;
}

/**
 * Log a day's attendance/labor (SPEC-0006 slice 2 — ACTUAL day-to-day labor, distinct from PLANNED
 * `plan_labor_requirements`). RLS (`labor_logs.tenant_all` WITH CHECK, migration 20260701310000)
 * re-enforces `authorize('labor.write', org_id)` — owner/farm_manager/supervisor — plus the same-org
 * guards on `person_id`/`plan_op_id`. No wage/rate is ever written here; hours only.
 */
export async function createLaborLog(
  input: LaborLogInput,
): Promise<{ ok: boolean; error?: string }> {
  const personId = input.personId || null;
  const teamName = input.teamName?.trim() || null;
  if (!personId && !teamName) {
    return { ok: false, error: "اختر عضو فريق أو أدخل اسم فريق" };
  }
  if (personId && teamName) {
    return { ok: false, error: "اختر إمّا عضو فريق أو اسم فريق، وليس الاثنين" };
  }
  if (!input.workDate) return { ok: false, error: "التاريخ مطلوب" };
  if (!Number.isFinite(input.hours) || input.hours <= 0) {
    return { ok: false, error: "عدد الساعات يجب أن يكون رقمًا أكبر من صفر" };
  }

  const m = await requireMembership();
  const sb = await createClient();
  const { error } = await sb.from("labor_logs").insert({
    org_id: m.orgId,
    person_id: personId,
    team_name: teamName,
    work_date: input.workDate,
    hours: input.hours,
    note: input.note?.trim() || null,
  });
  if (error) {
    return { ok: false, error: toArabicError(error, { "42501": NO_LABOR_PERM }) };
  }
  revalidatePath("/people/attendance");
  return { ok: true };
}
