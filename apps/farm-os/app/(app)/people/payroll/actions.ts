"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  PAYROLL_CLOSE_MESSAGE_AR,
  PAYROLL_CONFIRM_REQUIRED_AR,
  parsePayrollPeriod,
  payrollCloseFailure,
} from "@/lib/payroll-close";
import { isUuid } from "@/lib/payroll-report";

export type PayrollCloseResult =
  | { ok: true; runId: string | null }
  | { ok: false; error: string };

export interface PayrollCloseInput {
  periodStart: string;
  periodEnd: string;
  /** Must be literally `true`: the immutable-freeze confirmation the form makes the user give. */
  confirmImmutable: boolean;
}

/**
 * The run id out of the RPC's report jsonb — and only when it is really present and really a uuid.
 * Everything else about the payload is ignored: the report itself is always re-read from the
 * database under RLS, never carried over from this response.
 */
function readRunId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const runId = (payload as { run_id?: unknown }).run_id;
  return isUuid(runId) ? runId : null;
}

/**
 * Close a payroll period (SPEC-0006 slice 3).
 *
 * AUTHORIZATION is re-established here from the SERVER SESSION on every call — `requireRole`
 * resolves the signed-in user's ACTIVE org membership and its role, redirecting anyone who is not
 * owner/accountant. The org id sent to the RPC is `m.orgId` and nothing else: no org ever arrives
 * from the client, so a forged form field cannot aim this at another tenant. The database re-checks
 * both anyway (`p_org not in user_org_ids()` → 42501, `authorize('payroll.read', p_org)` → 42501),
 * so the UI gate is the outer layer, never the only one.
 *
 * NO PRE-CHECK RACE. It calls `fn_close_payroll_run` DIRECTLY. Reading payroll_runs first to decide
 * "is this period free?" would be a check outside the RPC's per-org EXCLUSIVE advisory lock — the
 * classic TOCTOU the migration's CONC-1 hardening exists to eliminate. The RPC alone decides:
 * idempotent replay for the exact same period, 23505 for an overlapping one.
 *
 * NO RAW DB TEXT. The RPC's raises interpolate person and org UUIDs; every failure is mapped to one
 * of the seven fixed Arabic messages in PAYROLL_CLOSE_MESSAGE_AR (non-negotiable #2).
 */
export async function closePayrollRun(input: unknown): Promise<PayrollCloseResult> {
  // AUTHORIZATION FIRST, before the input is even looked at. A server action is a public endpoint:
  // an unauthenticated or wrong-role caller must be redirected, not answered with a validation
  // verdict that tells them their payload was well-formed enough to reach the next check.
  const m = await requireRole(["owner", "accountant"]);
  if (!isUuid(m.orgId)) return { ok: false, error: PAYROLL_CLOSE_MESSAGE_AR.general };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: PAYROLL_CLOSE_MESSAGE_AR.validation };
  }
  const candidate = input as Record<string, unknown>;

  const period = parsePayrollPeriod(candidate.periodStart, candidate.periodEnd);
  if (!period.ok) return { ok: false, error: period.error };
  // The freeze is irreversible, so the confirmation is a server-side precondition — not merely a
  // second click the client could skip.
  if (candidate.confirmImmutable !== true) {
    return { ok: false, error: PAYROLL_CONFIRM_REQUIRED_AR };
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_close_payroll_run", {
    p_org: m.orgId,
    p_period_start: period.start,
    p_period_end: period.end,
  });
  if (error) return { ok: false, error: payrollCloseFailure(error).message };

  revalidatePath("/people/payroll");
  revalidatePath("/people/dashboard");

  return { ok: true, runId: readRunId(data) };
}
