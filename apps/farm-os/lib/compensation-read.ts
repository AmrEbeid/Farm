// Compensation reading — the bounded, org-scoped, fail-closed reads behind «أجور الفريق».
//
// READ-ONLY, THROUGH THE USER SESSION. Every query here goes through the caller's own session client,
// so `people_compensation`'s `comp_rw` policy (org_id ∈ user_org_ids() AND authorize('payroll.read',
// org_id) — owner/accountant, migrations 0046/0074) applies in Postgres exactly as it would to any
// other query that caller could make. The `.eq("org_id", …)` filters are defence-in-depth on top of
// RLS, never the primary control, and the org id always comes from the SERVER session
// (`requireRole(...).orgId`) — never from a URL, a form field or a prop.
//
// TWO QUERIES, NEVER N+1. All people names and the compensation rows are read once each and joined in
// memory on person_id. Only active people are offered for new rates, but inactive people remain named
// on existing rows so an accountant can identify the row safely. Nothing loops a query per person or
// per row.
//
// BOUNDED AND FAIL-CLOSED. Each list is fetched with LIMIT = max + 1 so an overflow is DETECTED
// rather than silently truncated, and BOTH a failed read and an overflow refuse the whole editor.
// This matters more here than on an ordinary list: a wage editor that silently dropped rows would
// show a worker as having NO saved rate when they do, and the obvious next action — "add a rate" —
// would then collide with the partial unique index, or worse, look like it needs a second rate.
// Refusing outright is the only honest option.
//
// NO CONTACT PII. `people` is read for `id, name, active` only. Phone/email are PII-locked
// (SPEC-0048) and are never selected here, not even to be discarded.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types.ext";
import { moneyNumber } from "@/lib/money";
import { isUuid } from "@/lib/uuid";

/** The largest team directory this editor will inspect. Beyond it the page refuses, never truncates. */
export const COMPENSATION_PEOPLE_MAX = 400;
export const COMPENSATION_PEOPLE_FETCH = COMPENSATION_PEOPLE_MAX + 1;

/** The largest set of saved rates this editor will render. Same posture. */
export const COMPENSATION_ROWS_MAX = 800;
export const COMPENSATION_ROWS_FETCH = COMPENSATION_ROWS_MAX + 1;

/** `people` is read for the display name and active flag only — no contact PII (SPEC-0048). */
export const COMPENSATION_PERSON_COLUMNS = "id, name, active" as const;
export const COMPENSATION_ROW_COLUMNS =
  "id, person_id, mode, unit, rate, contract_period_start, contract_period_end" as const;

export const COMPENSATION_READ_FAILED_AR =
  "تعذّرت قراءة بيانات الأجور. لم تُعرض أي أرقام.";
export const COMPENSATION_OVERFLOW_AR =
  "عدد السجلات أكبر من الحد الذي تعرضه هذه الصفحة، ولن تُعرض جزئيًا حتى لا يبدو عاملٌ له أجر وكأنه بلا أجر.";

/** A person who may be given a rate. Name only — this list never carries contact details. */
export interface CompensationPerson {
  id: string;
  name: string;
}

/** One saved rate, joined to its person's name in memory. */
export interface CompensationRowView {
  id: string;
  personId: string;
  /** The person's name, or COMPENSATION_UNKNOWN_PERSON_AR — never a raw id on a wage list. */
  personName: string;
  mode: string;
  unit: string | null;
  rate: number | null;
  contractPeriodStart: string | null;
  contractPeriodEnd: string | null;
}

/**
 * Used only if a compensation row references a person absent from the org-scoped directory result.
 * Inactive people are still read and named; they are merely excluded from the create picker.
 */
export const COMPENSATION_UNKNOWN_PERSON_AR = "عضو غير نشط";

export type CompensationEditorLoad =
  | { ok: true; people: CompensationPerson[]; rows: CompensationRowView[] }
  | { ok: false; error: string };

const READ_FAILED: CompensationEditorLoad = { ok: false, error: COMPENSATION_READ_FAILED_AR };
const OVERFLOWED: CompensationEditorLoad = { ok: false, error: COMPENSATION_OVERFLOW_AR };

/**
 * The team directory and every saved rate for the active org, ready for the editor.
 *
 * Order of checks — each one closes rather than degrades:
 *   1. A malformed org id never reaches PostgREST.
 *   2. Either read failing refuses the whole editor.
 *   3. Either list exceeding its bound refuses the whole editor.
 *   4. Names are joined from the list already fetched — no third query, no per-row lookup.
 */
export async function loadCompensationEditor(
  sb: SupabaseClient<Database>,
  orgId: string,
): Promise<CompensationEditorLoad> {
  if (!isUuid(orgId)) return READ_FAILED;

  const [
    { data: personRows, error: personError },
    { data: compRows, error: compError },
  ] = await Promise.all([
    sb
      .from("people")
      .select(COMPENSATION_PERSON_COLUMNS)
      .eq("org_id", orgId)
      .order("name")
      .limit(COMPENSATION_PEOPLE_FETCH),
    sb
      .from("people_compensation")
      .select(COMPENSATION_ROW_COLUMNS)
      .eq("org_id", orgId)
      .order("person_id")
      .order("mode")
      .limit(COMPENSATION_ROWS_FETCH),
  ]);

  if (personError || compError) return READ_FAILED;

  const people = personRows ?? [];
  const comps = compRows ?? [];
  if (people.length > COMPENSATION_PEOPLE_MAX || comps.length > COMPENSATION_ROWS_MAX) {
    return OVERFLOWED;
  }

  const nameById = new Map(people.map((person) => [person.id, person.name]));

  return {
    ok: true,
    people: people
      .filter((person) => person.active === true)
      .map((person) => ({
        id: person.id,
        name: person.name?.trim() || COMPENSATION_UNKNOWN_PERSON_AR,
      })),
    rows: comps.map((row) => ({
      id: row.id,
      personId: row.person_id,
      personName: nameById.get(row.person_id)?.trim() || COMPENSATION_UNKNOWN_PERSON_AR,
      mode: row.mode,
      unit: row.unit,
      rate: moneyNumber(row.rate),
      contractPeriodStart: row.contract_period_start,
      contractPeriodEnd: row.contract_period_end,
    })),
  };
}
