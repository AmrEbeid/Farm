"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

/**
 * RPW-1: server actions for the pest-scouting module (trap register, weekly catch log, incident
 * reports). Every write goes through a SECURITY DEFINER RPC (fn_save_trap / fn_update_trap /
 * fn_log_trap_catch / fn_report_pest_incident, migration 20260701300000) which enforces
 * op.execute IN THE DATABASE — these actions only keep the request authenticated, resolve
 * human-entered codes (sector/hawsha/line/trap code, palm id_tag) to ids via an RLS-scoped read,
 * and map the DB error to a field-safe Arabic message (lib/errors). The DB is the single source
 * of truth for the permission gate.
 */

const NO_PEST_PERM = "ليس لديك صلاحية لتسجيل بيانات مكافحة السوسة";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/farm/pest-scouting");
}

// ── register a trap ─────────────────────────────────────────────────────────────────────────────
export interface RegisterTrapInput {
  code: string;
  label: string;
  installedAt: string;
  sectorCode?: string | null;
  hawshaCode?: string | null;
  lineCode?: string | null;
  lureChangedAt?: string | null;
  notes?: string | null;
}

export async function registerTrap(input: RegisterTrapInput): Promise<Result<string>> {
  const code = input.code?.trim();
  const label = input.label?.trim();
  if (!code) return { ok: false, error: "كود المصيدة مطلوب" };
  if (!label) return { ok: false, error: "اسم المصيدة مطلوب" };
  if (!input.installedAt) return { ok: false, error: "تاريخ التركيب مطلوب" };

  const m = await requireMembership();
  const sb = await createClient();

  let sectorId: string | null = null;
  let hawshaId: string | null = null;
  let lineId: string | null = null;

  if (input.sectorCode?.trim()) {
    const { data, error } = await sb.from("sectors").select("id").eq("code", input.sectorCode.trim()).maybeSingle();
    // A6: a transient DB error must NOT read as "not found" — distinguish it from a genuine miss.
    if (error) return { ok: false, error: toArabicError(error) };
    if (!data) return { ok: false, error: `القطاع بالرمز "${input.sectorCode.trim()}" غير موجود` };
    sectorId = data.id;
  }
  if (input.hawshaCode?.trim()) {
    const { data, error } = await sb.from("hawshat").select("id").eq("code", input.hawshaCode.trim()).maybeSingle();
    if (error) return { ok: false, error: toArabicError(error) };
    if (!data) return { ok: false, error: `الحوشة بالرمز "${input.hawshaCode.trim()}" غير موجودة` };
    hawshaId = data.id;
  }
  if (input.lineCode?.trim()) {
    const { data, error } = await sb.from("lines").select("id").eq("line_code", input.lineCode.trim()).maybeSingle();
    if (error) return { ok: false, error: toArabicError(error) };
    if (!data) return { ok: false, error: `الخط بالرمز "${input.lineCode.trim()}" غير موجود` };
    lineId = data.id;
  }

  const { error } = await sb.rpc("fn_save_trap", {
    p_org: m.orgId,
    p_code: code,
    p_label: label,
    p_installed_at: input.installedAt,
    p_sector_id: sectorId,
    p_hawsha_id: hawshaId,
    p_line_id: lineId,
    p_lure_changed_at: input.lureChangedAt?.trim() || null,
    p_notes: input.notes?.trim() || null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PEST_PERM }) };

  revalidate();
  return { ok: true };
}

export async function registerTrapFromForm(
  values: Record<string, string | number | null>,
): Promise<Result<string>> {
  return registerTrap({
    code: values.code != null ? String(values.code) : "",
    label: values.label != null ? String(values.label) : "",
    installedAt: values.installedAt != null ? String(values.installedAt) : "",
    sectorCode: values.sectorCode != null ? String(values.sectorCode) : null,
    hawshaCode: values.hawshaCode != null ? String(values.hawshaCode) : null,
    lineCode: values.lineCode != null ? String(values.lineCode) : null,
    lureChangedAt: values.lureChangedAt != null ? String(values.lureChangedAt) : null,
    notes: values.notes != null ? String(values.notes) : null,
  });
}

// ── log a weekly catch ──────────────────────────────────────────────────────────────────────────
export interface LogCatchInput {
  trapCode: string;
  checkedAt: string;
  catchCount: number;
  notes?: string | null;
}

export async function logCatch(input: LogCatchInput): Promise<Result> {
  const trapCode = input.trapCode?.trim();
  if (!trapCode) return { ok: false, error: "كود المصيدة مطلوب" };
  if (!input.checkedAt) return { ok: false, error: "تاريخ الفحص مطلوب" };
  if (input.catchCount == null || !Number.isFinite(input.catchCount) || input.catchCount < 0) {
    return { ok: false, error: "عدد الصيد غير صالح" };
  }

  await requireMembership();
  const sb = await createClient();

  const { data: trap, error: trapError } = await sb.from("pest_traps").select("id").eq("code", trapCode).maybeSingle();
  if (trapError) return { ok: false, error: toArabicError(trapError) };
  if (!trap) return { ok: false, error: `المصيدة بالرمز "${trapCode}" غير موجودة` };

  const { error } = await sb.rpc("fn_log_trap_catch", {
    p_trap_id: trap.id,
    p_checked_at: input.checkedAt,
    p_catch_count: input.catchCount,
    p_notes: input.notes?.trim() || null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PEST_PERM }) };

  revalidate();
  return { ok: true };
}

export async function logCatchFromForm(values: Record<string, string | number | null>): Promise<Result> {
  return logCatch({
    trapCode: values.trapCode != null ? String(values.trapCode) : "",
    checkedAt: values.checkedAt != null ? String(values.checkedAt) : "",
    catchCount: values.catchCount != null ? Number(values.catchCount) : NaN,
    notes: values.notes != null ? String(values.notes) : null,
  });
}

// ── update a trap (lure-changed date / status / notes), by code ────────────────────────────────
export interface UpdateTrapInput {
  trapCode: string;
  lureChangedAt?: string | null;
  status?: string | null;
  notes?: string | null;
}

export async function updateTrap(input: UpdateTrapInput): Promise<Result> {
  const trapCode = input.trapCode?.trim();
  if (!trapCode) return { ok: false, error: "كود المصيدة مطلوب" };
  if (input.status && input.status !== "active" && input.status !== "removed") {
    return { ok: false, error: "حالة المصيدة غير صالحة (نشطة / مُزالة)" };
  }

  await requireMembership();
  const sb = await createClient();

  const { data: trap, error: trapError } = await sb.from("pest_traps").select("id").eq("code", trapCode).maybeSingle();
  if (trapError) return { ok: false, error: toArabicError(trapError) };
  if (!trap) return { ok: false, error: `المصيدة بالرمز "${trapCode}" غير موجودة` };

  const { error } = await sb.rpc("fn_update_trap", {
    p_trap_id: trap.id,
    p_lure_changed_at: input.lureChangedAt?.trim() || null,
    p_status: input.status?.trim() || null,
    p_notes: input.notes?.trim() || null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PEST_PERM }) };

  revalidate();
  return { ok: true };
}

export async function updateTrapFromForm(values: Record<string, string | number | null>): Promise<Result> {
  return updateTrap({
    trapCode: values.trapCode != null ? String(values.trapCode) : "",
    lureChangedAt: values.lureChangedAt != null ? String(values.lureChangedAt) : null,
    status: values.status != null ? String(values.status) : null,
    notes: values.notes != null ? String(values.notes) : null,
  });
}

// ── report a suspected/confirmed pest incident ──────────────────────────────────────────────────
const VALID_SEVERITIES = ["watch", "suspected", "confirmed"] as const;
type Severity = (typeof VALID_SEVERITIES)[number];

export interface ReportIncidentInput {
  trapCode?: string | null;
  palmIdTag?: string | null;
  reportedAt: string;
  severity: string;
  notes?: string | null;
  responseAction?: string | null;
}

export async function reportIncident(input: ReportIncidentInput): Promise<Result> {
  const trapCode = input.trapCode?.trim() || null;
  const palmIdTag = input.palmIdTag?.trim() || null;
  if (!trapCode && !palmIdTag) {
    return { ok: false, error: "أدخل كود مصيدة أو رقم تعريف نخلة على الأقل لتحديد موقع البلاغ" };
  }
  if (!input.reportedAt) return { ok: false, error: "تاريخ البلاغ مطلوب" };
  if (!VALID_SEVERITIES.includes(input.severity as Severity)) {
    return { ok: false, error: "درجة الاشتباه غير صالحة (متابعة / اشتباه إصابة / إصابة مؤكدة)" };
  }

  await requireMembership();
  const sb = await createClient();

  let trapId: string | null = null;
  let assetId: string | null = null;

  if (trapCode) {
    const { data, error } = await sb.from("pest_traps").select("id").eq("code", trapCode).maybeSingle();
    if (error) return { ok: false, error: toArabicError(error) };
    if (!data) return { ok: false, error: `المصيدة بالرمز "${trapCode}" غير موجودة` };
    trapId = data.id;
  }
  if (palmIdTag) {
    const { data, error } = await sb
      .from("assets")
      .select("id")
      .eq("id_tag", palmIdTag)
      .eq("type", "palm")
      .maybeSingle();
    if (error) return { ok: false, error: toArabicError(error) };
    if (!data) return { ok: false, error: `النخلة برقم التعريف "${palmIdTag}" غير موجودة` };
    assetId = data.id;
  }

  const { error } = await sb.rpc("fn_report_pest_incident", {
    p_reported_at: input.reportedAt,
    p_severity: input.severity,
    p_trap_id: trapId,
    p_asset_id: assetId,
    p_notes: input.notes?.trim() || null,
    p_response_action: input.responseAction?.trim() || null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PEST_PERM }) };

  revalidate();
  return { ok: true };
}

export async function reportIncidentFromForm(values: Record<string, string | number | null>): Promise<Result> {
  return reportIncident({
    trapCode: values.trapCode != null ? String(values.trapCode) : null,
    palmIdTag: values.palmIdTag != null ? String(values.palmIdTag) : null,
    reportedAt: values.reportedAt != null ? String(values.reportedAt) : "",
    severity: values.severity != null ? String(values.severity) : "",
    notes: values.notes != null ? String(values.notes) : null,
    responseAction: values.responseAction != null ? String(values.responseAction) : null,
  });
}
