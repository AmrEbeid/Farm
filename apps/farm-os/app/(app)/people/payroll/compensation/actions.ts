"use server";

// Save one `people_compensation` row (SPEC-0006 slice 4). Owner/accountant only.
//
// WHY DIRECT REST AND NOT AN RPC. `people_compensation` has been client-writable since migration
// 0046: `grant select, insert, update ... to authenticated` plus the `comp_rw` policy, whose USING
// *and* WITH CHECK both require `org_id ∈ user_org_ids() AND authorize('payroll.read', org_id)`, and
// whose WITH CHECK additionally proves the referenced person is a SAME-ORG person (migration 0074,
// #306). DELETE was deliberately withheld then and is still withheld now — this action never deletes,
// and there is no delete path anywhere on the surface. Adding an RPC would be a schema change; this
// slice ships against the live table exactly as it already stands.
//
// AUTHORIZATION FIRST, ALWAYS. `requireRole` runs before the input is read at all. A server action is
// a public endpoint: a wrong-role caller must be redirected, not answered with a validation verdict
// that confirms their payload shape.
//
// SESSION ORG ONLY. `org_id` is `m.orgId`. Nothing about tenancy is ever taken from the client.
//
// TWO INDEPENDENT TENANCY CHECKS. (1) The person is re-read org-scoped before any write, so a forged
// person id fails with a plain Arabic sentence rather than a 23514 out of the RLS WITH CHECK. (2) An
// UPDATE filters on id AND org_id AND person_id and asks for the updated row back: zero rows returned
// means the row was not this org's, or not this person's, and the action refuses. Neither check
// replaces RLS — RLS is the boundary; these two make the boundary's refusals legible.
//
// NO RAW DB TEXT (non-negotiable #2). Every failure becomes one of the fixed constants in
// COMPENSATION_MESSAGE_AR. A wage table's error strings can echo rates; none of them may reach a UI.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  COMPENSATION_MESSAGE_AR,
  compensationFailure,
  parseCompensationInput,
} from "@/lib/compensation";
import { isUuid } from "@/lib/uuid";

export type CompensationSaveResult =
  | { ok: true; mode: "created" | "updated" }
  | { ok: false; error: string };

export async function saveCompensation(input: unknown): Promise<CompensationSaveResult> {
  // AUTHORIZATION FIRST — before the input is even inspected.
  const m = await requireRole(["owner", "accountant"]);
  if (!isUuid(m.orgId)) return { ok: false, error: COMPENSATION_MESSAGE_AR.general };

  const parsed = parseCompensationInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const value = parsed.value;

  const sb = await createClient();

  // The person must be one of THIS org's people. A read error is a refusal, never an assumption that
  // the person exists (fail closed): a wage row attached to the wrong person is not recoverable by
  // the person it was attached to.
  const { data: person, error: personError } = await sb
    .from("people")
    .select("id")
    .eq("org_id", m.orgId)
    .eq("id", value.personId)
    .maybeSingle();
  if (personError) return { ok: false, error: COMPENSATION_MESSAGE_AR.general };
  if (!person) return { ok: false, error: COMPENSATION_MESSAGE_AR.missing_person };

  const columns = {
    mode: value.mode,
    rate: value.rate,
    unit: value.unit,
    contract_period_start: value.contractPeriodStart,
    contract_period_end: value.contractPeriodEnd,
  };

  if (value.rowId) {
    const { data: updated, error } = await sb
      .from("people_compensation")
      .update(columns)
      .eq("id", value.rowId)
      .eq("org_id", m.orgId)
      .eq("person_id", value.personId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: compensationFailure(error).message };
    // Zero rows: the row is not this org's, or not this person's, or no longer exists. RLS makes
    // those three indistinguishable on purpose — and all three have the same next step.
    if (!updated) return { ok: false, error: COMPENSATION_MESSAGE_AR.not_found };
  } else {
    const { error } = await sb
      .from("people_compensation")
      .insert({ org_id: m.orgId, person_id: value.personId, ...columns });
    if (error) return { ok: false, error: compensationFailure(error).message };
  }

  revalidatePath("/people/payroll/compensation");
  revalidatePath("/people/payroll");
  revalidatePath("/people/dashboard");
  return { ok: true, mode: value.rowId ? "updated" : "created" };
}
