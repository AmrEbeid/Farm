# Payroll privacy and access review — Stage M evidence packet

*Farm OS · SPEC-0006 (People, labor & payroll) · MASTER-PLAN Stage 8 + Stage M · prepared 2026-07-29*

**Status: INDEPENDENT TECHNICAL REVIEW COMPLETE — OWNER PRIVACY APPROVAL NOT SIGNED — STAGE M NOT CLEARED.**

This document is the reviewable packet for the independent access review that SPEC-0006 §4.1 and
MASTER-PLAN Stage 8 make a **hard requirement**, and for the privacy review that gates Stage M. It is
written to be re-runnable: every technical claim points at a file, a migration section, or a named
test that a second reviewer can execute themselves.

**What this document does NOT do, and may not be quoted as doing:**

- It does **not** clear Stage M. Stage M requires written Owner approval from a **separate approver**
  who is not the actor that produced the change (`docs/CLAUDE.md` § Owner & approvals).
- It does **not** authorise importing real staff PII, rates, contracts, phone numbers, e-mail
  addresses or documents into any environment. That authorisation does not exist yet.
- It does **not** state that payroll is complete or "100%". Payroll has never been exercised by an
  authenticated owner/accountant against real data, and no dated acceptance exists.
- It does **not** assert any legal conclusion about Egyptian or UK data-protection, employment,
  payroll-tax or retention obligations. §11 records those as **open questions for a qualified
  adviser**, unanswered.
- Its technical assertions rest on **source and local pgTAP evidence**, plus **one read-only hosted
  metadata probe** run by the independent reviewer on 2026-07-29 and recorded verbatim in §9.1
  (catalog and `information_schema` queries only — no table data read, no write, no schema change).
  Where a property can be proven only against the hosted project and has **not** been probed, this
  document says so explicitly (§9) rather than implying it has been checked. **No live request path
  has been exercised** (L-3 remains open); metadata is not behaviour.

Everything exercised while producing this packet used **synthetic fixtures**. No real person, rate,
contract, phone number, e-mail address or document was read, written, exported, or sent to any model.

---

## 1. Scope

### 1.1 In scope

The confidentiality boundary around staff personal data and pay data in `apps/farm-os`, specifically:

| Area | Concretely |
|---|---|
| Tables | `people`, `people_compensation`, `labor_logs`, `payroll_runs`, `payroll_run_lines`, `audit_log`, `responsibility_assignments`, `plan_labor_requirements`, `organization_member` |
| Permissions | `authorize()` — `payroll.read`, `people.write`, `labor.write` |
| RPCs | `public.fn_close_payroll_run`, `private.fn_payroll_run_report`, `private.fn_payroll_run_mutex_key`, the payroll/labor/compensation trigger guards |
| Routes | `/people`, `/people/[personId]`, `/people/dashboard`, `/people/attendance`, `/people/payroll`, `/people/payroll/[runId]`, `/people/payroll/compensation`, `/people/payroll/readiness` |
| Server actions | `app/(app)/people/actions.ts`, `app/(app)/people/payroll/actions.ts`, `app/(app)/people/payroll/compensation/actions.ts` |
| Import | `app/api/import/route.ts`, `lib/import/access.ts`, the three `payroll-readiness-*` validation-only descriptors |
| AI | `lib/assistant-policy.ts` (the عبدالجليل capability boundary) |
| Export / print | CSV export surfaces, the printable payroll pages |
| Errors / logging | `lib/errors.ts`, route `error.tsx` boundaries, server-action failure strings |

### 1.2 Out of scope (named, so absence is deliberate rather than overlooked)

- Payment execution and journal posting. Neither exists; the close moves no money and writes no
  journal entry (`20260729090000_payroll_run_persistence.sql` header, "NO PAYMENT EXECUTION"). Their
  scope decision is an **open Owner gate**, not a finding.
- Tax, social-insurance and end-of-service engines — explicitly deferred by SPEC-0006 §3 "Forbidden".
- The accounting/finance confidentiality boundary (SPEC-0004 / SPEC-0018), reviewed separately.
- Supabase Auth account hygiene. The live `*@ebeid.test` demo-identity rotation is an **open
  Owner-only item** already recorded in `SECURITY-NOTES.md` §5.1; it is cross-referenced in §10 but
  not re-litigated here.
- Physical/organisational security, device security, and the farm's paper records.

### 1.3 Method

1. Read `docs/CLAUDE.md`, `SPEC-0006`, `MASTER-PLAN.md` Stage 8 + Stage M, `SECURITY-NOTES.md`,
   `PILOT-READINESS.md`, `PERMISSIONS-MATRIX.md`, `SESSION-BRIEF.md`.
2. Read **every** migration touching people/labor/payroll and **every** pgTAP test referencing
   `people_compensation`, `labor_logs`, `payroll` or contact PII (test inventory in §8.1).
3. Read the app routes, server actions, nav registry, import framework, assistant policy and error
   mapping listed in §1.1.
4. Built a role × data/action matrix (§5) from the **policy predicates and grants**, not from the UI.
5. Ran the full local pgTAP harness and the full app Vitest suite as a baseline, added the missing
   evidence (§8.2), and re-ran both.
6. Separated the result into: verified technical evidence (§8), live/operator checks that cannot be
   run from source (§9), and governance approvals that are human acts (§10).
7. After the first independent-review round, recorded the reviewer's **read-only hosted metadata
   probe** (§9.1), which closed F-1 and live checks L-1, L-2, L-4 and L-11, and revised §8.2 N-1/N-2 in
   response to that round's findings. The probe is **not** re-runnable from this repo — it needs
   hosted read access, so it is evidence a reviewer must obtain themselves, not a command in §1.4.

### 1.4 Reviewer's re-run commands

```bash
cd apps/farm-os
bash supabase/test-shims/run-pgtap-local.sh    # Docker-free ephemeral PG; exit 0 iff all pass
npx vitest run                                  # app unit/static-contract suite
npx tsc --noEmit
npm run build                                   # includes the bundle/chart guards
```

---

## 2. Threat model

The asset is **confidentiality of staff identity, contact details and pay**, plus **integrity of a
closed payroll snapshot**. Availability is not a primary concern for this review.

| # | Threat actor | Capability assumed | What they want | Primary control |
|---|---|---|---|---|
| T1 | **Unauthenticated internet caller (`anon`)** | Can reach the public PostgREST endpoint and `/rest/v1/*`, `/rest/v1/rpc/*` with the publishable anon key | Any wage, contact or payroll row | No `anon` grant on any public table; `anon` EXECUTE revoked on every non-helper SECURITY DEFINER function; RLS + FORCE RLS deny-by-default |
| T2 | **Curious in-org member** (supervisor, storekeeper, farm_manager, agri_engineer) | Valid session, browser DevTools, direct REST calls, can craft any query the `authenticated` role is granted | Colleagues' wages and phone numbers | `authorize('payroll.read', org_id)` in RLS; column-GRANT lockdown on `people.phone`/`people.email` |
| T3 | **Cross-org member** (an accountant serving two farms; a former member of another tenant) | Legitimately holds `payroll.read` **in their own org** | The other farm's payroll | `org_id in (select user_org_ids())` on every policy; `user_org_ids()` keyed on `auth.uid()` and membership-validated |
| T4 | **Audit-log side channel** | Any authenticated member; `audit_log` mirrors full rows | Wages/PII read out of the audit mirror rather than the base table | `audit_read` gates payroll entity types on `payroll.read`; `fn_audit_people` strips `phone`/`email` before writing |
| T5 | **AI assistant / third-party model** | A future tool layer with a session client | Compensation or contact data leaving the tenant into a model | `lib/assistant-policy.ts` deny-by-default allow-list + SENSITIVE regex; SPEC-0005 permission parity |
| T6 | **Import/export path** | Owner or accountant uploading a workbook; anyone downloading a report | Bulk exfiltration; accidental commit of real PII | Descriptor `allowedRoles` + validation-only refusal before body parse; no payroll/contact export descriptor exists |
| T7 | **Error/log surface** | Any user; anyone with log access | PII echoed in an error string, a log line, or a stack trace | Fixed Arabic message maps; no `console.*` on any people/payroll path |
| T8 | **Privileged/internal path** | A SECURITY DEFINER function, a `bypassrls` owner, or service-role code | Bypassing RLS through a definer routine or an owner-context write | FORCE RLS on every tenant table; internal functions have client EXECUTE revoked; immutability triggers fire even for the table owner |
| T9 | **Insider with legitimate payroll.read** | Owner or accountant | Exfiltrating the whole wage table | **Partially mitigated only.** Audit records writes, not reads. See F-4. |

The Supabase service-role key's non-exposure was verified at the 2026-07-29 source, local-build and
deployed-bundle snapshot by the self-testing CI guard described in §9.2 (L-8). This is a continuing
property, so CI repeats the repository, module-graph and local browser-bundle arms on every change.
The hosted project's row-level security was **partly** verified on 2026-07-29: RLS is enabled **and
forced** on all five payroll/PII tables, and `anon` holds no DML there (§9.1, L-1/L-2). The hosted
**policy predicates** and migration head match the ledger (L-4); the live request path is still
unverified (L-3).

---

## 3. Data classification

| Class | Fields | Where it lives | Intended reader |
|---|---|---|---|
| **C3 — Confidential (pay)** | `people_compensation.rate`, `.mode`, `.unit`, `.contract_period_start/end`; `payroll_runs.total_gross`; `payroll_run_lines.quantity/rate/gross` | `people_compensation`, `payroll_runs`, `payroll_run_lines`, and their `audit_log` mirror | owner, accountant — **same org only** |
| **C3 — Confidential (contact)** | `people.phone`, `people.email` | `people` (columns retained as the service-role linking key) | **Nobody** through the client role. Service-role paths only. |
| **C2 — Internal (roster)** | `people.name`, `.position`, `.employment_type`, `.active`, `.reports_to_person_id`, `.user_id` | `people` | Any member of the org (org-scoped) |
| **C2 — Internal (labor evidence)** | `labor_logs.person_id/team_name/work_date/hours/mode/quantity/unit/note` | `labor_logs` | Any member of the org (org-scoped). **See §6.3 — this classification needs Owner ratification.** |
| **C2 — Internal (assignment)** | `responsibility_assignments`, `plan_labor_requirements`, `plan_operation_assignees` | those tables | Any member of the org |
| **C1 — Operational** | `audit_log` rows for non-sensitive entity types | `audit_log` | Any member of the org |

**Classification consequence used throughout:** C3 must be role-gated *in Postgres*, not in the UI.
C2 must be org-gated in Postgres. A UI that merely hides a C3 field is **not** a control.

---

## 4. Actors and roles

App roles are values of `organization_member.role`, resolved per-org by
`public.authorize(perm text, p_org uuid)`. The current definition is the highest-numbered re-emit:
`supabase/migrations/20260725201546_accounting_reconciliation_provenance.sql:466-485` (21
permissions). Completeness of that re-emit is itself pinned by
`supabase/tests/97_authorize_perms_complete_test.sql` — this matters because the re-emit pattern has
historically dropped permissions silently.

| Actor | `organization_member.role` | Payroll-relevant permissions |
|---|---|---|
| Owner | `owner` | `payroll.read`, `people.write`, `labor.write` (and every other permission) |
| Accountant | `accountant` | `payroll.read` only (no `people.write`, no `labor.write`) |
| Farm manager | `farm_manager` | `people.write`, `labor.write` — **no** `payroll.read` |
| Supervisor | `supervisor` | `labor.write` — **no** `people.write`, **no** `payroll.read` |
| Agri engineer | `agri_engineer` | neither — **no** `payroll.read` |
| Storekeeper | `storekeeper` | neither — **no** `payroll.read` |
| `anon` | — (unauthenticated Postgres role) | none; holds no table DML anywhere |
| Cross-org member | any role, **different `org_id`** | permissions evaluate per-org; `user_org_ids()` excludes non-member orgs |

Active-org narrowing: `public.user_org_ids()` returns the **active** org when a validated
`active_org_id` JWT claim is present, otherwise the full membership set
(`20260622000085_active_org.sql`). A forged claim can only narrow to a real membership, never widen.
**The hosted `custom_access_token_hook` enablement is unverified** — `SECURITY-NOTES.md` §0.1; see
§9 L-5. This matters for a genuine two-farm accountant, not for the single-org pilot.

---

## 5. Role × data/action matrix

Derived from policy predicates and grants, not from routes. `✔` = permitted; `✘` = denied by the
database; `svc` = service-role only.

### 5.1 Read

| Data | owner | accountant | farm_manager | supervisor | agri_engineer | storekeeper | anon | cross-org member |
|---|---|---|---|---|---|---|---|---|
| `people` roster (name/position/type/active/reports_to/user_id) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ |
| `people.phone` / `people.email` | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ (svc only) |
| `people_compensation` (wages) | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `labor_logs` (hours/attendance) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ |
| `payroll_runs` | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `payroll_run_lines` | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `audit_log` — `people_compensation` / `payroll_run` / `payroll_run_line` | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `audit_log` — `people` (phone/email already stripped at write time) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ |
| `audit_log` — `labor_logs` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ |

### 5.2 Write

| Action | owner | accountant | farm_manager | supervisor | agri_engineer | storekeeper | anon | cross-org member |
|---|---|---|---|---|---|---|---|---|
| Create/update a person (`people.write`) | ✔ | ✘ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Delete a person | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ (no client DELETE grant) |
| Insert/update a wage row (`people_compensation`) | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Delete a wage row | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ (DELETE withheld) |
| Log attendance (`labor.write`) | ✔ | ✘ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ |
| Delete a labor log | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Edit a labor log inside a **closed** period | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ (freeze trigger, even for the table owner) |
| `EXECUTE fn_close_payroll_run` | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ (no grant) | ✘ (42501 cross-org guard) |
| Update/delete a `payroll_runs` / `payroll_run_lines` row | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ (immutability trigger, all roles) |
| Insert a `payroll_runs` row directly | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ (no INSERT grant; RPC is the only path) |
| `EXECUTE private.fn_payroll_run_report` / `fn_payroll_run_mutex_key` | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Import committing wage/labor data | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ (validation-only descriptors have no RPC) |

### 5.3 Route reachability (app layer — defence in depth, never the boundary)

| Route | `requireRole` | Nav `roles` | Agrees with DB? |
|---|---|---|---|
| `/people` | owner, farm_manager, agri_engineer, accountant | same | ✔ (roster is C2 org-read) |
| `/people/[personId]` | owner, farm_manager, agri_engineer, accountant | (under `people`) | ✔ |
| `/people/dashboard` | owner, farm_manager, agri_engineer, accountant | same | ✔ — the wage estimate is additionally gated on `authorize('payroll.read')` before it queries |
| `/people/attendance` | owner, farm_manager, supervisor | same | ✔ (matches `labor.write`) |
| `/people/payroll` | owner, accountant | owner, accountant | ✔ (matches `payroll.read`) |
| `/people/payroll/[runId]` | owner, accountant | (under `payroll`) | ✔ |
| `/people/payroll/compensation` | owner, accountant | owner, accountant | ✔ |
| `/people/payroll/readiness` | owner, accountant | owner, accountant | ✔ |

No route grants more than the DB does. Confirmed by static contract tests (§8.1 rows A-1…A-6) plus
the new repo-wide invariant (§8.2 N-2).

---

## 6. PII and pay flow inventory

Each flow is stated as: **where the data is**, **who can reach it**, **what the control is**, and
**what remains unproven**.

### 6.1 `people` — public roster fields

- **Fields:** `id, org_id, name, position, employment_type, user_id, active, reports_to_person_id, created_at`.
- **Read:** org-scoped `tenant_all` policy, no role gate — every member sees the roster. This is
  deliberate: assignment, planning and attendance surfaces all need names.
- **Write:** gated on `authorize('people.write')` — owner/farm_manager only
  (`20260701300000_people_labor_write_gates.sql:78-79`). No client DELETE grant.
- **Cross-org:** `reports_to_person_id` is constrained to the same org
  (`20260622000071_people_reports_to_same_org.sql`).
- **Audit:** `fn_audit_people` writes a **redacted** mirror — `to_jsonb(row) - 'phone' - 'email'`
  (`20260622000060_audit_people_redacted.sql`). EXECUTE revoked from `public, anon, authenticated`.
- **Unproven:** nothing material. Roster visibility is a product decision the Owner has already made.

### 6.2 `people_contacts` — phone and e-mail

There is **no `people_contacts` table**. Contact PII lives as two columns on `people`. This matters
for the review, because a reader looking for a contacts table would wrongly conclude none exists.

- **Control:** `revoke select on public.people from authenticated`, then a column-list re-grant that
  **omits `phone` and `email`** (`20260622000048_contact_pii_lockdown.sql:32-47`). A bare column-level
  revoke would have been ineffective against the pre-existing table-wide grant; this is the correct
  mechanism.
- **Effect:** a query selecting either column fails the **whole statement** with `42501`, for every
  app role including owner and accountant. Contact access is not a payroll privilege.
- **Why the columns stay:** `people.phone` is the service-role linking key that maps GoTrue users to
  `people` rows. Service-role bypasses grants and RLS, so the lockdown does not affect it.
- **Audit side channel:** closed by the redacting audit function (§6.1) and by the generic
  column-restriction invariant in `tests/56` arm (4), which forbids any table audited by the generic
  `fn_audit` from having a column `authenticated` cannot read.
- **Unproven / open:**
  - **No owner-gated read path exists yet.** The migration anticipates "a future owner-gated
    SECURITY DEFINER RPC". Until one exists, an owner who needs a worker's phone number must get it
    outside the system. That is a **product gap the Owner must decide on** before real onboarding —
    see G-H7 in §12.
  - The exact contact-visibility policy SPEC-0006 §5.3 asked the Owner to decide
    ("exactly which roles see phone/email") has **never been answered**. The implementation chose the
    most conservative reading (nobody). That default should be **ratified, not merely inherited**.

### 6.3 `labor_logs` — attendance and labor evidence

- **Read:** org-scoped, **no role gate** (`20260701310000_labor_logs.sql:60-71`). Every member —
  storekeeper included — can read who worked, when, and for how many hours.
- **Write:** `authorize('labor.write')` — owner/farm_manager/supervisor. Same-org guards on
  `person_id` and `plan_op_id` in `WITH CHECK`. No DELETE grant.
- **Freeze:** once a period is closed, `fn_guard_labor_log_payroll_freeze` rejects insert/update/delete
  of any row whose `work_date` falls in that period — including a privileged cross-org "move".
- **Stated justification for the open read:** the table carries **no rate or money column**, so hours
  alone cannot leak a wage.

**Classification question the brief asks to resolve — answer:** as implemented, labor evidence is
**operational (C2), not payroll-confidential (C3)**, and the justification is structurally sound *as
long as the table stays money-free*. That "as long as" was previously only a comment; it is now a
catalog invariant (§8.2 N-1 assertion 1), so a future migration adding a `rate`/`gross`/`amount`
column to `labor_logs` fails the suite instead of silently widening wage exposure.

**However, this classification is a design choice, not a neutral fact, and it is NOT ratified.**
Hours are still personal data about an identified worker: combined with a known day-rate convention
they approximate pay, and they reveal absence, illness patterns and working time to every colleague.
**Recommendation to the Owner: ratify explicitly** — either (a) confirm C2/operational and record the
reasoning, or (b) reclassify to C3 and gate reads on a new `labor.read` permission. Do **not** import
real attendance data before this is answered. Recorded as **G-H8**.

### 6.4 `people_compensation` — rates and contracts

- **Table:** `20260622000046_people_compensation.sql:44-76`. `enable` + **`force`** RLS; single
  policy `comp_rw` gating SELECT *and* write on
  `org_id in (select user_org_ids()) and authorize('payroll.read', org_id)`; `grant select, insert,
  update` to `authenticated` only; **DELETE deliberately withheld**.
- **The original defect it closed:** `people.rate` sat on the org-readable `people` table, so any
  member could read everyone's pay. The column is dropped at line 86 — verified absent by
  `tests/46`.
- **Same-org person guard:** `20260622000074_people_comp_person_org.sql` — a wage row cannot be
  attached to another org's person (`tests/73`).
- **`anon`:** revoked explicitly in `20260622000079_people_comp_anon_revoke.sql:13`, because Supabase's
  platform default ACL had granted it. **This precedent is the basis of finding F-1.**
- **Modes:** hourly / daily / piece(+unit) / seasonal(+exact contract bounds), with partial unique
  indexes making an ambiguous rate structurally impossible.
- **Audit:** generic `fn_audit('people_compensation')`, gated in `audit_read` on `payroll.read`.

### 6.5 `payroll_runs` / `payroll_run_lines` — the closed snapshot

- **Read:** `payroll_read` policies, `org_id in user_org_ids() and authorize('payroll.read', org_id)`
  (`20260729090000:390-392, 448-450`). FORCE RLS on both. `grant select` only.
- **Write:** **no client INSERT/UPDATE/DELETE grant at all.** The sole write path is
  `public.fn_close_payroll_run`, `SECURITY DEFINER`, `search_path = ''`, EXECUTE revoked from
  `public, anon, authenticated` then granted to `authenticated` (lines 795-796), with the org and
  role re-checked **inside** the body:
  - `p_org not in (select user_org_ids())` → `42501` — **a caller-supplied foreign org is refused**;
  - `not authorize('payroll.read', p_org)` → `42501`.
- **Immutability:** `fn_immutable_payroll_row` rejects every UPDATE and DELETE unconditionally, so a
  closed run cannot be altered even by the table owner or a `bypassrls` definer path.
- **Concurrency:** per-org advisory mutex (EXCLUSIVE for the close, SHARE for labor and compensation
  writes), plus a unique-constraint claim-first backstop and an overlapping-period reject.
- **Fail-closed:** missing/zero/negative rate, free-text crew, empty period, inverted period, null
  bounds, unsupported unit, and cross-org person reference each abort the **whole** close with zero
  rows written.
- **Internals:** `private.fn_payroll_run_report(uuid)` (returns a run's wage lines as jsonb) and
  `private.fn_payroll_run_mutex_key(uuid)` have EXECUTE revoked from `public, anon, authenticated`
  (lines 620, 319). Those revokes were **not covered by any test** before this review — closed by
  §8.2 N-1 assertions 2-5, and separately confirmed **on the hosted project** by the L-11
  `has_function_privilege` probe (§9.1: false for both roles on both functions).

### 6.6 `audit_log`

- `audit_read` gates `people_compensation`, `payroll_run` and `payroll_run_line` on `payroll.read`,
  and excludes them from the open org-member branch (`20260729090000:560-589`).
- Two independent guards exist: `tests/56` (dynamic — every role-restricted audited table must be
  gated) and `tests/131` (vocabulary pin — every sensitive entity must appear in **both** policy
  locations). `tests/131`'s vocabulary was **missing `payroll_run` and `payroll_run_line`**; a stale
  re-emit could have dropped either from the exclusion list and still passed. Closed by §8.2 N-3.
- `audit_log` is append-only and immutable (`tests/02`, `tests/25`).
- **Audit records writes, not reads.** See F-4.

### 6.7 Import — templates and dry-run

- Three descriptors (`payroll-readiness-staff|compensation|labor`), all `validationOnly: true`:
  the type system refuses them an `rpc`, `toRpcArgs`, `table`, `matchKey` and `archiveType`;
  `planCommit` throws if one ever reaches it.
- `allowedRoles: ["owner","accountant"]`, enforced **server-side** in `app/api/import/route.ts` via
  `lib/import/access.ts`.
- **Ordering is the control:** descriptor and mode travel as **query parameters** precisely so both
  the role gate and the no-commit gate run **before `req.formData()`** — a wrong role's upload is
  never taken off the wire, and a validation-only commit is refused before parsing, before ref
  lookups, before `planCommit`. Pinned by source-order assertions in `lib/import/access.test.ts`
  ("route ordering" block).
- **No contact columns** in either direction: the descriptors declare no `table`, so no template is
  ever prefilled from the database, and no column asks for a phone or an e-mail.
- **No PII echo:** the refusal messages never echo the submitted descriptor, mode, or role. The only
  read against real data is the `people.name → id` reference lookup, RLS-scoped to the active org,
  never returned in the response. Ambiguous names fail closed (resolve to neither).
- Examples are visibly synthetic («عامل تجريبي ١») and live on the instructions sheet, never parsed.
- **Already fully covered by existing tests — deliberately not duplicated by this review.**

### 6.8 AI / assistant

- `lib/assistant-policy.ts` is deny-by-default: only an explicitly allow-listed read RPC is permitted
  (`ASSISTANT_READ_TOOLS` currently contains `fn_stock_coverage` alone).
- Refusal-first ordering means a name matching several forbidden classes still refuses. The
  `SENSITIVE` regex matches `compensation|payroll|salary|wage|\brate\b|phone|email|pii|bank|iban|
  account_no|national_id`.
- `assertRlsScopedClient` throws for anything but the session client — no service-role, no admin.
- Pinned by `lib/assistant-policy.test.ts`, including the slice-3 payroll surface
  (`fn_close_payroll_run`, `payroll_runs`, `payroll_run_lines`, `fn_payroll_run_report`).
- **Residual, stated honestly:** this is a *capability boundary module*, not a deployed AI. No AI
  route consumes it today. If a future `/api/chat` is built, the review of that route is a **new**
  requirement — this packet does not pre-clear it.
- `labor_logs` is not matched by `SENSITIVE`, but is refused anyway by deny-by-default (not on the
  allow-list). If labor is reclassified to C3 (§6.3), add it to `SENSITIVE` explicitly.

### 6.9 Export and print

- **No bulk-export descriptor or registry entry exists for payroll, compensation, labor or contact
  data** anywhere in the repo. (`docs/SPEC-0016` "export compliance" is unrelated — see below.)
- **CSV export does exist on the people module, and it carries roster data only.** `/people` exports
  the directory table and `/people/dashboard` exports three tables (workload, unassigned operations,
  directory). Their columns are `name`, `position`, `employment_type` and open-operation counts —
  C2 roster fields. **No wage, rate, gross, phone or e-mail column appears in any of them.**
- **The two money-rendering surfaces are print-only by design.** `/people/payroll` and
  `/people/payroll/[runId]` use `PrintButton` and carry **no `exportFilename` at all**; the people
  dashboard's hourly wage estimate renders through a bare `SimpleTable` with no export prop, inside a
  block already gated on `authorize('payroll.read')`.
  That distinction is exactly one React prop wide — adding `exportFilename` to the estimate table
  would turn C3 wage figures into a browser download in a one-line change. It is therefore now
  **pinned**, not trusted (§8.2 N-2, "wage figures are never offered as a CSV download").
- A printed payroll report is a physical C3 artefact — handling is a human control, recorded as
  **G-H6**.
- `docs/SPEC-0016` "export compliance" is agricultural export certification, unrelated to data export.
  Noted because the name invites confusion in an access review.
- **Unproven:** browser print-to-PDF, screenshots and the browser cache are outside any technical
  control. Named, not solved.

### 6.10 Errors and logging

- Every server action maps DB failures through fixed Arabic message constants
  (`PAYROLL_CLOSE_MESSAGE_AR`, `COMPENSATION_MESSAGE_AR`) or `lib/errors.ts` `toArabicError`, which
  maps SQLSTATE → Arabic and **never** returns `error.message`.
- This matters concretely: `fn_close_payroll_run`'s own `raise` statements interpolate person and org
  UUIDs (`'missing or invalid rate for (person:mode/unit): %'`). Those raw strings must never reach a
  UI — and they do not, because the action maps by SQLSTATE.
- **There is no `console.log`/`console.warn`/`console.error` on any people, payroll, compensation,
  labor or import path.** The only `console.error` calls in the app are the four route/global error
  boundaries and two unrelated stock/plan paths.
- **Unproven:** what Vercel and Supabase actually retain in their own request/query logs, and who can
  read them. That is a §9 live check (L-6) and a §11 retention question.

---

## 7. Compensating and structural controls (context for the matrix)

| Control | Where | Why it matters here |
|---|---|---|
| FORCE RLS on every tenant table | `tests/29` (per-table + dynamic invariant) | Table owners and definer paths obey RLS too |
| Every RLS policy is org- or owner-scoped; none is `using (true)` | `tests/136` INV-6a/6b | A future payroll-adjacent table cannot ship permissive |
| No public SECURITY DEFINER function is anon-EXECUTE-able except the two RLS helpers | `tests/22` INV-1 | Covers the payroll trigger guards automatically |
| `authenticated` EXECUTE limited to an explicit allow-list of definer RPCs | `tests/22` INV-2 (includes `fn_close_payroll_run`) | A new definer function cannot silently become client-callable |
| `anon` holds no DML on any public table | `tests/80`, `tests/97_grant_hygiene`; hosted probe §9.1 | Defence in depth behind RLS. Local end-state pinned by test; the **hosted** state for the payroll/PII tables verified once on 2026-07-29 (L-1) — the suite still cannot see it, so the standing check under F-1 stands |
| Audit coverage + retention for payroll tables | `tests/79_audit_coverage_retention` (includes `payroll_runs`, `payroll_run_lines`) | Payroll writes are recorded |
| Cross-org FK sweeps | `tests/62-65`, `71`, `74`, `75` | No payroll-adjacent FK can straddle tenants |

---

## 8. Evidence register — verified code and DB evidence

**Interpretation rule.** Everything in §8 is proven by **source inspection plus the local Docker-free
pgTAP harness and the app Vitest suite**. The harness runs as a superuser, so it verifies **policy
predicates, grants, catalog flags and impersonated-role behaviour**, but it cannot verify the hosted
project's actual ACLs, PostgREST behaviour, or GoTrue configuration. Those are §9.

### 8.1 Pre-existing evidence (read and confirmed, not authored here)

| # | Property | Evidence |
|---|---|---|
| A-1 | `people.rate` no longer exists; wages preserved in `people_compensation`; `payroll.read` true for owner/accountant and false for the other four roles; accountant sees wage rows under RLS, supervisor sees zero | `supabase/tests/46_people_compensation_confidential_test.sql` (10) |
| A-2 | `people.phone`/`.email` retained but `SELECT` denied to a member with `42501`; non-PII columns still readable; service-role unaffected | `supabase/tests/48_contact_pii_confidential_test.sql` (6) |
| A-3 | `people_compensation` audit rows hidden from a non-payroll member, visible to owner; `audit_read` names `payroll.read` and preserves org scope | `supabase/tests/53_audit_compensation_payroll_gate_test.sql` (5) |
| A-4 | No role-restricted audited table is ungated in `audit_read`; no audited table has a column `authenticated` cannot read (with non-vacuity guards on both arms) | `supabase/tests/56_audit_leak_invariant_test.sql` (4) |
| A-5 | `fn_audit_people` strips every column `authenticated` cannot select | `supabase/tests/61_people_audit_redacted_test.sql` |
| A-6 | `people.write` / `labor.write` role sets; a non-`people.write` member cannot create a person but can read the directory | `supabase/tests/114_people_labor_write_gates_test.sql` (8) |
| A-7 | `labor_logs` FORCE RLS, no anon grant, no DELETE grant, person-or-team CHECK, hours CHECK, `labor.write` gate, cross-org `person_id` rejected, audited | `supabase/tests/115_labor_logs_test.sql` (14) |
| A-8 | `people_compensation` cannot reference a cross-org person | `supabase/tests/73_people_comp_person_org_test.sql` (3) |
| A-9 | Payroll close: owner and accountant succeed; **supervisor refused (42501)**; **non-member refused (42501)**; **anon cannot execute at all**; hand-computed mixed-mode reconciliation; fail-closed on missing rate / empty period / bad period / free-text crew / cross-org reference / bad unit; sequential + real two-session idempotency; overlap reject; labor freeze; seasonal exact-period; immutability; confidential audit (supervisor sees zero payroll audit rows, accountant sees them); grants/`search_path`/FORCE RLS/constraints | `supabase/tests/20260729090000_payroll_run_persistence_test.sql` (104) |
| A-10 | `authorize()` re-emit completeness — all 21 permissions with their exact role sets | `supabase/tests/97_authorize_perms_complete_test.sql` (45) |
| A-11 | INV-1 / INV-2 definer-function EXECUTE lockdown (public schema) | `supabase/tests/22_security_invariants_test.sql` (12) |
| A-12 | `anon` holds no DML on any public table (local end state) | `supabase/tests/80_anon_dml_lockdown_test.sql` (2), `97_grant_hygiene_default_privileges_test.sql` (5) |
| A-13 | Payroll surface: nav visible to owner/accountant only; `requireRole` on both pages, the close action and the compensation page/action; **authorisation runs before input inspection**; session org only, never a caller-supplied org; no pre-check race; no raw DB text; no phone/email selected anywhere on the payroll surface; compensation editor never deletes; the people dashboard's wage read is `payroll.read`-gated | `apps/farm-os/lib/payroll-surface.test.ts` |
| A-14 | Readiness page: owner/accountant only; queries nothing; every descriptor validation-only; no commit-capable panel; claims no completion/percentage/approval; names no person, rate or farm | `apps/farm-os/lib/payroll-readiness-surface.test.ts` |
| A-15 | Import gates: descriptor `allowedRoles` enforced; validation-only commit refused; **both gates precede `req.formData()`**; body is never a routing input; no descriptor/mode/role echo in refusals | `apps/farm-os/lib/import/access.test.ts`, `lib/import/descriptors/payroll-readiness.test.ts` |
| A-16 | Assistant policy denies compensation/payroll/PII/outbound/privileged/write; deny-by-default for unknown names; slice-3 payroll surface explicitly refused | `apps/farm-os/lib/assistant-policy.test.ts` |
| A-17 | Attendance and compensation-read surfaces select no phone/email | `lib/attendance-surface.test.ts`, `lib/compensation-read.test.ts`, `lib/payroll-report.test.ts` |

### 8.2 Evidence added by this review

Three additions. Each closes a **named** gap; none duplicates an existing assertion.

**N-1 — `apps/farm-os/supabase/tests/142 payroll access review evidence test.sql` (new, 34 assertions)**

| Gap it closes | Why nothing covered it before |
|---|---|
| **Direct RLS read of `payroll_runs` / `payroll_run_lines` by each of the six app roles** — owner and accountant see the run and its line; farm_manager, agri_engineer, supervisor and storekeeper see **zero** on both tables | The slice-3 test proves the RPC refuses a supervisor and that payroll **audit** rows are hidden, and pins the anon **grant** — but every one of its payroll-table reads runs as the superuser or through the SECURITY DEFINER RPC. Nothing asserted what the six roles see querying the base tables directly through PostgREST, which is precisely the attack the UI cannot prevent |
| **Direct RLS read of `people_compensation` by each of the six app roles** — owner and accountant see the wage row; the other four see **zero** — completing the §5.1 matrix for all three C3 tables in one place, on one set of fixtures | **Partly covered, and the gap is specific:** `tests/46` exercises the direct table read for exactly **two** of the six roles (accountant → rows, supervisor → zero) and covers the remaining four only through `authorize('payroll.read')`, which is a permission fact, not a read fact. Owner, farm_manager, agri_engineer and storekeeper had **no** direct-read assertion anywhere. The two roles `46` already covers are restated here on this file's own fixtures so the six-role row is self-contained; they are **not** claimed as new evidence |
| **Cross-org read denial** for `people_compensation`, `payroll_runs`, `payroll_run_lines`, `labor_logs` and `people`, with the caller being a **genuine `payroll.read` holder in their own org**, plus two non-vacuity controls proving the same caller does read their own org's rows | Tests 01/24/62-65/74-76 cover cross-org **writes** and the inventory/engine tables; none touches the payroll/PII tables. The realistic actor (an accountant serving two farms) was untested |
| **`private.fn_payroll_run_report(uuid)` and `private.fn_payroll_run_mutex_key(uuid)` hold no `anon`/`authenticated` EXECUTE** | `tests/22` INV-1/INV-2 are scoped to `nspname = 'public'`, so both were covered by no grant invariant at all. `fn_payroll_run_report` returns a whole run's wage lines as jsonb and is SECURITY DEFINER — a stray grant on it bypasses the `payroll.read` RLS entirely |
| **Contact PII is denied to the payroll roles too** — owner and accountant both get `42501` on `people.phone` and `people.email` | `tests/48` proves it for a supervisor. The review needs the stronger statement the migration implements: holding `payroll.read` buys no contact access. The go/no-go checklist depends on that being true |
| **`labor_logs` carries no rate/gross/salary/wage/amount/cost/pay/price column** (catalog invariant) | The org-wide read class rests on this fact, which existed only as a comment in the migration header. A future money column would silently widen wage exposure to every org member |

**N-2 — `apps/farm-os/lib/people-pii-access-surface.test.ts` (new, 13 cases)**

Repo-wide static invariants. The existing PII pins are per-surface file lists (payroll, attendance,
compensation); none says anything about the other ~17 `.from("people")` reads across plans, reports,
custody, the mobile route, the owner dashboard and settings. This walks **every** `app/` and `lib/`
source and checks each read individually:

- no `people` projection selects `phone` or `email`, anywhere;
- no `select("*")` on `people` (a wildcard requests the denied columns and `42501`s the whole page);
- every `people` projection is a string literal or one of three named column constants — an opaque
  or computed projection is rejected outright, because that is how a contact read would get back in;
- the three named constants are themselves PII-free;
- no PostgREST embed of the shape `people(...)` names `phone` or `email` (attendance already uses
  `people(name)`, so the shape is live and would bypass the `.from()` scan);
- every direct `payroll_runs` / `payroll_run_lines` read stays inside `lib/payroll-report.ts`, and
  every route consuming it is gated on `requireRole(["owner","accountant"])` — the equivalent pin
  existed for `people_compensation` but **not** for the run tables;
- **no CSV export exists on any payroll route**, the people-dashboard **wage estimate card carries no
  `exportFilename`**, and the dashboard's three exported tables carry no wage column (§6.9);
- **non-vacuity is enforced per file, not in aggregate.** This is the load-bearing part of a static
  scan, and the first draft of this test got it wrong. An aggregate floor
  (`projections >= readerFiles`) is satisfiable while an entire file goes unparsed, because one file
  contributing several projections covers the shortfall of a file contributing none — and every PII
  assertion then skips that file in silence. So **each** file containing a `people` chain must
  resolve at least one chain, and **every** chain it resolves must land on a known PostgREST verb
  (`select`/`insert`/`update`/`upsert`/`delete`); an unresolved chain fails rather than disappearing.
  Two supporting changes make that floor honest: the scan reads **comment-stripped** source (two
  `.from("people")` mentions in `plans/[planId]/page.tsx` are prose, not queries), and each chain's
  window is **cut at the next `.from("`** so a write-only chain cannot adopt an unrelated later
  `.select(...)`. The single write chain exempt from the projection floor —
  `createPerson`'s `people.insert` — is itself pinned by name, so a second direct write path fails
  the suite instead of being silently excused. Verified by mutation: making one file's chain
  unresolvable fails the new per-file case, and **passed** under the previous aggregate-only floor.
- non-vacuity elsewhere: the reader-file count, a known literal projection, the `people(name)` embed,
  and the existence of each scanned block are floored too, so a regex that stops matching fails the
  test instead of passing it empty.

**N-3 — `apps/farm-os/supabase/tests/131_audit_read_sensitive_pin_test.sql` (extended, +2 vocabulary entries)**

`payroll_run` and `payroll_run_line` were added to the `audit_read` policy by migration
`20260729090000` but never added to the completeness pin. A later re-emit could have kept either in
the gated branch while dropping it from the open-branch exclusion — the exact stale-copy leak this
pin exists to catch — and the suite would have stayed green. Assertion count unchanged (the pin is a
set-difference count); the vocabulary is now complete.

### 8.3 Test results

| Run | Before | After |
|---|---|---|
| pgTAP (`run-pgtap-local.sh`) | 3067 assertions, 0 failures, 0 file failures | **3101 assertions, 0 failures, 0 file failures** |
| App Vitest | 89 files, 1219 passed, 13 skipped | **90 files, 1232 passed, 13 skipped** |
| `tsc --noEmit` | clean | clean |
| ESLint (touched files) | — | clean |
| `git diff --check` | — | clean |

---

## 9. Live and operator checks — L-1, L-2, L-4, L-8 and L-11 **DONE**; the rest **open**

These cannot be established from source or from the local harness. Each is a required verification
before real payroll data, with the reason it cannot be answered here.

**Five of them have now been run.** On 2026-07-29 the independent reviewer (Codex) executed
**read-only metadata SQL** against the hosted project `veezkmytervjnpxcrbkw` — catalog and
`information_schema` queries only, no table data read, no schema change, no write. Their verbatim
results are recorded in §9.1 and are the basis for closing **F-1**. They remain *metadata* checks:
they establish the hosted ACL, RLS flags and function privileges, **not** the live PostgREST/GoTrue
deny behaviour, which stays open as **L-3**. L-8 used a separate read-only source/build/deployed-
asset scan recorded in §9.2.

| # | Check | Why it is not answerable from source | Owner/operator action |
|---|---|---|---|
| **L-1** ✅ | On the hosted project `veezkmytervjnpxcrbkw`, confirm `anon` holds **no** privilege (including SELECT) on `labor_logs`, `payroll_runs`, `payroll_run_lines` | The local harness models only migration-granted privileges; the hosted platform `supabase_admin` default ACL is a known separate grantor. See **F-1** | **DONE 2026-07-29** — read-only `information_schema.role_table_grants` probe, `grantee = 'anon'`. **No rows** for `labor_logs`, `payroll_runs`, `payroll_run_lines`. `people_compensation` returned **only `REFERENCES` and `TRIGGER`** — no `SELECT`/`INSERT`/`UPDATE`/`DELETE`. See §9.1 and **F-1** |
| **L-2** ✅ | Confirm `people_compensation`, `payroll_runs`, `payroll_run_lines`, `labor_logs`, `people` all report `rowsecurity` **and** `forcerowsecurity` true on the hosted project | Superuser bypass makes FORCE unverifiable locally | **DONE 2026-07-29** — `pg_class` probe: `relrowsecurity = true` **and** `relforcerowsecurity = true` on all five tables. See §9.1 |
| **L-3** | Exercise the deny path against the **live PostgREST endpoint** with a real supervisor JWT: `GET /rest/v1/payroll_runs`, `payroll_run_lines`, `people_compensation`, and `select=phone` on `people` — all must return empty or 401/403, never data | PostgREST/GoTrue behaviour is not modelled locally | Authenticated smoke with a test account |
| **L-4** ✅ | Confirm the hosted migration ledger head matches this repo's payroll migration and that no out-of-band schema change has widened a payroll policy | The repo is not the live database | **DONE 2026-07-29** — hosted migration head is `payroll_run_persistence` (hosted version `20260729102938`; repository source `20260729090000_payroll_run_persistence.sql`). The five `pg_policies` rows for `people`, `people_compensation`, `labor_logs`, `payroll_runs`, and `payroll_run_lines` match the repository's final predicates, commands, and authenticated-role scope. See §9.1 |
| **L-5** | Verify `custom_access_token_hook` is enabled and a freshly minted token carries a membership-validated `active_org_id` | Dashboard setting; `config.toml` proves local config only. `SECURITY-NOTES.md` §0.1 | Required **before onboarding a second org**; matters for a two-farm accountant |
| **L-6** | Determine what Vercel and Supabase logs retain from payroll requests, how long, and who can read them | Provider configuration | Feeds §11 retention questions |
| **L-7** | Confirm no Supabase database backup, branch, or copy containing staff PII exists outside the production project, and that backup access is restricted | Provider configuration | Feeds §11 |
| **L-8** ✅ | Confirm the production `service_role` key is not present in any client bundle or repository artefact | Non-exposure is a source, build and deployed-asset property | **DONE 2026-07-29** — self-testing guard scanned 1,251 tracked files (14,267,098 bytes), 77 client roots / 430 source files / 381 resolved edges, 155 local client assets (2,411,324 bytes), and all 13 JavaScript chunks referenced by the public production `/` and `/login` pages (962,463 downloaded bytes including the bounded HTML/manifest inputs). No elevated JWT, `sb_secret_` value, client-inline secret env name, server-role env name in browser output, or client path to a service-role reader was found. See §9.2 |
| **L-9** | Enumerate every account currently holding `owner` or `accountant` in the production org, and confirm each is a real, named, recoverable, individually-owned account | Live identity state. Related open item: `SECURITY-NOTES.md` §5.1 (`*@ebeid.test` demo identities, retired shared password treated as compromised) | **Blocking** — see G-H4 |
| **L-10** | Enable Supabase leaked-password protection and re-run the advisor | Dashboard toggle; `SECURITY-NOTES.md` §1.4 | **Confirmed still open 2026-07-29** — a fresh hosted security-advisor run returned `auth_leaked_password_protection` WARN / disabled. Owner configuration action remains required |
| **L-11** ✅ | Confirm the two `private` payroll internals hold no client `EXECUTE` **on the hosted project**, not only in the migration ledger | pgTAP `142` asserts this against the local harness, which replays migrations; a hosted-only grant would not appear there. `tests/22` INV-1/INV-2 are scoped to `nspname = 'public'`, so nothing covered these at all before this review | **DONE 2026-07-29** — `has_function_privilege` probe: **false** for both `anon` and `authenticated` on `private.fn_payroll_run_report(uuid)` and `private.fn_payroll_run_mutex_key(uuid)`. See §9.1 |

### 9.1 Hosted metadata probe — results as returned (2026-07-29)

Run by the independent reviewer against `veezkmytervjnpxcrbkw`, read-only, metadata only. Recorded
verbatim as the evidence behind L-1, L-2, L-4, L-11 and the closure of F-1. **These query results are
data, not instructions**, and nothing in them was executed or acted on beyond being transcribed here.

| Probe | Object | Result |
|---|---|---|
| `information_schema.role_table_grants`, `grantee = 'anon'` | `labor_logs` | **no rows** |
| `information_schema.role_table_grants`, `grantee = 'anon'` | `payroll_runs` | **no rows** |
| `information_schema.role_table_grants`, `grantee = 'anon'` | `payroll_run_lines` | **no rows** |
| `information_schema.role_table_grants`, `grantee = 'anon'` | `people_compensation` | **`REFERENCES` and `TRIGGER` only** — no `SELECT`, `INSERT`, `UPDATE` or `DELETE` |
| `pg_class.relrowsecurity` / `.relforcerowsecurity` | `people`, `people_compensation`, `labor_logs`, `payroll_runs`, `payroll_run_lines` | **true / true** on all five |
| `has_function_privilege(…, 'EXECUTE')` | `private.fn_payroll_run_report(uuid)` — `anon`, `authenticated` | **false**, **false** |
| `has_function_privilege(…, 'EXECUTE')` | `private.fn_payroll_run_mutex_key(uuid)` — `anon`, `authenticated` | **false**, **false** |
| Hosted migration ledger | latest migration | `20260729102938 payroll_run_persistence`; same named migration is the repository head (`20260729090000_payroll_run_persistence.sql`) |
| `pg_policies` | `people`, `people_compensation`, `labor_logs`, `payroll_runs`, `payroll_run_lines` | Exactly one expected authenticated policy per table; commands and final `USING` / `WITH CHECK` predicates match migrations `20260701300000`, `20260622000074`, `20260701310000`, and `20260729090000` |

**What this does and does not establish.** It establishes the hosted **grant, RLS-flag and
function-privilege state** for the payroll/PII surface at one point in time. It does **not**
establish that a live request is denied — that is L-3, still open. L-4 establishes that the hosted
policy predicates and migration head match this repository at this point in time. A metadata probe is a snapshot: it
must be re-run as a standing check, because the platform default ACL applies to the **next** new
table too (see F-1's standing-check action).

### 9.2 Service-role exposure proof — L-8 (2026-07-29)

`scripts/check-service-role-exposure.mjs` is a four-arm, fail-closed guard:

1. every git-tracked repository artefact is scanned for elevated Supabase JWTs, current-format
   `sb_secret_` keys, and `NEXT_PUBLIC_` secret/service-role env names;
2. every `"use client"` static import graph is walked, with `"use server"` treated as the framework
   boundary, and must not reach any source module that reads `SUPABASE_SERVICE_ROLE_KEY`;
3. `.next/static` is scanned after a production build, and an optional `--bundle-dir` scans downloaded
   production chunks with separate non-vacuity floors; and
4. every detector must match an in-memory positive fixture and reject a benign fixture.

The graph arm derives service-role readers from executable `process.env` references instead of
maintaining an allow-list, and requires every reader to import `server-only`. Two positive controls
prove import resolution and the `"use server"` boundary are actually exercised. The guard never
reads local env files and reports only detector id, file and byte offset, never a matched value. CI
runs it immediately after `next build`.

For the deployed arm, the reviewer fetched the public HTML for `/` and `/login` from both
`ebeidfarm.business` and `farm-ui-one.vercel.app`, extracted the same-origin
`/_next/static/*.js` references, required downloaded count to equal referenced count, then scanned
the resulting temporary directory. **13/13 referenced JavaScript chunks downloaded; the deployed
arm passed.** No cookies, login, API key, staff data or private route was used.

---

## 10. Findings

Severity uses impact × exploitability × reversibility, per `docs/CLAUDE.md`.

### F-1 — `anon` grant drift on the three tables created after the last sweep · MEDIUM (defence-in-depth) · **CLOSED 2026-07-29 — VERIFIED CLEAN ON THE HOSTED PROJECT · NO MIGRATION NEEDED**

> **Resolution.** Live check **L-1** was run on 2026-07-29 (read-only metadata probe, §9.1). On the
> hosted project `veezkmytervjnpxcrbkw`, `information_schema.role_table_grants` for
> `grantee = 'anon'` returns **no rows at all** for `labor_logs`, `payroll_runs` and
> `payroll_run_lines` — the three tables this finding was about. The suspected platform default-ACL
> drift **did not occur**. Per the sequence this finding itself set out ("if `anon` holds nothing,
> no migration is needed and this finding closes as *verified clean, add a standing check*"), the
> proposed `revoke` migration is **withdrawn, not deferred**: it is not authored, not proposed, and
> would be a no-op change to a grant that does not exist. What remains is the **standing check**
> (below), because the next table created will land in the same window.
>
> **One residual, stated separately so it is not swept into the clean result.** On
> `people_compensation` the same probe returned **`REFERENCES` and `TRIGGER` for `anon`** — not zero
> rows. Those two are **not read and not DML**: `REFERENCES` permits creating a foreign key against
> the table, `TRIGGER` permits attaching a trigger to it, and neither returns a row or writes one.
> This is **consistent with migration `0079`, which revoked exactly `select, insert, update, delete`**
> and never claimed to strip the whole ACL. So the accurate statement is: **`anon` holds no read and
> no DML privilege on `people_compensation`** — *not* that it holds no privilege whatsoever. Both
> residual privileges are additionally unreachable in practice: `anon` cannot create objects in
> `public` (no `CREATE` on the schema), so neither can be exercised. Recorded here, in this wording,
> so no later document upgrades "0079 revoked DML" into "anon has nothing".

**What the finding was.** Supabase's platform default ACL (grantor `supabase_admin`) grants client-role privileges on
newly created public tables. Farm OS has fixed this **twice, reactively**:

- `20260622000079_people_comp_anon_revoke.sql:13` —
  `revoke select, insert, update, delete on public.people_compensation from anon;`
  Header: *"people_compensation was created later (0046) and picked up the grant from Supabase's
  platform default-privileges, which 0010's table-by-table revoke didn't cover."*
- `20260630090000_anon_table_dml_lockdown_residual.sql:35` —
  `revoke insert, update on all tables in schema public from anon;`
  Header, under **"Intentionally OUT OF SCOPE"**: *"`anon` SELECT still present on `attachments`,
  `plan_operation_assignees`, `user_active_org` … the platform `supabase_admin` default ACL remains a
  platform-owner remediation."*
- `20260629135038_grant_hygiene_default_privileges.sql:34-41` locks future default privileges for the
  `postgres` grantor, and attempts `supabase_admin` only when the migration role is a member —
  otherwise it is a **reported residual**.

**Three payroll-relevant tables were created after that last sweep** and therefore sit in the
uncovered window, with **no explicit `revoke … from anon`** in their own migrations:

| Table | Created by | Grant statement in its migration |
|---|---|---|
| `labor_logs` | `20260701310000_labor_logs.sql:76` | `grant select, insert, update on public.labor_logs to authenticated;` — no anon revoke |
| `payroll_runs` | `20260729090000:392` | `grant select on public.payroll_runs to authenticated;` — no anon revoke |
| `payroll_run_lines` | `20260729090000:450` | `grant select on public.payroll_run_lines to authenticated;` — no anon revoke |

**Why the existing tests could not settle it — still true, and the reason a live probe was required.**
`tests/80`'s own header states the harness *"models only MIGRATION-granted privileges … NOT
Supabase's platform default-privileges"*; `tests/97_grant_hygiene` scopes its default-ACL assertion to
grantors *"the migration role can administer"*. Both prove the **desired local end state**; neither
can prove the hosted one, and that remains the case after L-1 — the probe closed the question, the
test suite did not and cannot. The payroll test's
`not has_table_privilege('anon', 'public.payroll_runs', 'SELECT')` is likewise a local assertion.
**This is the structural gap that makes the standing check below necessary rather than optional.**

**Actual risk, as assessed before the probe.** Low in practice, and never a demonstrated leak: both
tables have `enable` + `force` RLS with a policy requiring `org_id in (select user_org_ids())` **and**
`authorize('payroll.read', org_id)` — now confirmed enabled *and forced* on the hosted project by L-2.
An `anon` caller has a null `auth.uid()`, so `user_org_ids()` is empty and `authorize()` is false —
zero rows regardless of the grant. The concern was that the **grant layer would stop being a second,
independent boundary** for the two most sensitive tables in the system, which is exactly the reasoning
that produced migration `0079`. L-1 shows that second boundary is intact.

**No fix, and none proposed.** The earlier draft of this finding carried a candidate `revoke`
migration for the three tables. It is **removed**, because L-1 shows there is nothing to revoke: the
grants it targeted do not exist on the hosted project. Writing a migration anyway would be a schema
change with no effect, and every schema change costs an independent review and an Owner-gated apply.
**No migration file was authored by this review**, and no grant, policy, RPC or application behaviour
was changed.

**What remains — the standing check (open, an action, not a finding).** The probe is a snapshot of
one moment. The platform default-ACL window is a property of **table creation**, so the next
payroll-adjacent table added will sit in exactly the same window this finding was raised about. Add
to the deploy runbook, as a post-migration step whenever a new table lands in `public`:

- re-run the `information_schema.role_table_grants` probe for `grantee = 'anon'` over the payroll/PII
  tables **plus the newly created one**, and
- treat any `SELECT`/`INSERT`/`UPDATE`/`DELETE` row as a defect requiring an explicit revoke
  migration, while treating `REFERENCES`/`TRIGGER` as the known, non-DML residual described above.

This is recorded as an operational follow-up for the Owner; it is **not** a blocking gate for this
review, and it is not automatable from the repo (the local harness cannot see the hosted ACL — that
limitation is the whole reason F-1 existed).

### F-2 — `docs/PERMISSIONS-MATRIX.md` drifted from the implementation · LOW (documentation) · **CLOSED 2026-07-29**

The matrix predated SPEC-0006 slices 2-4. It omitted `people.write` and `labor.write` entirely, listed
`payroll.read` as *"Read `people_compensation` (wages)"* without `payroll_runs` / `payroll_run_lines`,
and its route table had no `/people/payroll*` rows. An independent reviewer using it as the authority
would have under-scoped the payroll surface. This review updates the matrix with the final permission
union, role capabilities, attendance route, and payroll/readiness routes.

### F-3 — SPEC-0006 §5.3 (contact-PII visibility policy) was never answered by the Owner · MEDIUM (governance) · OPEN

The spec asked the Owner to decide "exactly which roles see `phone`/`email`". The implementation
chose the most conservative available answer — **nobody, through the client role** — and shipped it.
That is the right default, but it is an **inherited** default, not a ratified decision, and it has a
concrete consequence: there is today **no in-app way for an owner to look up a worker's phone
number**. Before real onboarding the Owner must either ratify deny-by-default (and accept that
contact details live outside the system) or commission an owner-gated `SECURITY DEFINER` read RPC,
which would itself need an access review. Recorded as **G-H7**.

### F-4 — Read access to wage data is not audited · LOW-MEDIUM (accepted design, stated for the record) · NO FIX PROPOSED

`audit_log` records INSERT/UPDATE/DELETE. An owner or accountant who **reads** the entire wage table
or the full payroll report leaves **no trace**. That is normal for a Postgres/PostgREST application
and disproportionate to fix for a single-farm pilot, but it must be stated explicitly, because it is
the residual for threat T9: the payroll insider is controlled by *account hygiene and role
assignment* (L-9, G-H4), not by technology. **Do not describe the payroll surface as "fully
audited"** — writes are audited; reads are not.

### F-5 — `labor_logs` classification is a shipped default, not a ratified decision · MEDIUM (governance) · OPEN

See §6.3. The migration's own justification is sound and is now structurally pinned, but "every org
member, including the storekeeper, can see every worker's attendance and hours" is a privacy decision
the Owner has not made in writing. Recorded as **G-H8**.

### Non-findings (checked, found sound — recorded so the next reviewer does not re-derive them)

- The org supplied to `fn_close_payroll_run` is **always** the server-session org; a caller-supplied
  foreign org is rejected inside the RPC with `42501`, and the server action never accepts an org
  from the client.
- The people-dashboard wage estimate reads `people_compensation`, but only after
  `authorize('payroll.read')` returns true, and the DB would return zero rows regardless. Correctly
  layered (app gate as defence in depth, DB as boundary).
- The compensation editor writes through direct REST rather than an RPC. This is sound: `comp_rw`'s
  `WITH CHECK` requires org membership **and** `payroll.read` **and** a same-org person, and no
  DELETE grant exists. Adding an RPC would be a schema change with no security gain.
- The `authorize()` re-emit chain is complete at 21 permissions and independently pinned — the
  historical silent-drop footgun is closed for this surface.

---

## 11. Retention, export, backup and legal — **OPEN, UNANSWERED**

None of the following has been established. They are recorded as questions, with no answer implied.
**No legal conclusion about Egyptian or UK law is asserted anywhere in this document**, and none may
be inferred from its silence. These require a qualified adviser familiar with the operating
jurisdiction; they are not answerable by reading the codebase.

| # | Question | Current technical reality |
|---|---|---|
| R-1 | How long must payroll records be retained, and under whose law? | Indefinite. `payroll_runs` / `payroll_run_lines` are immutable and have **no deletion path at all** — by design |
| R-2 | How long may staff contact details be retained after a worker leaves? | Indefinite. `people` has no client DELETE grant; `active=false` is a flag, not erasure |
| R-3 | Is there a data-subject right of access, correction or erasure that applies, and how would it be satisfied? | **No mechanism exists.** Erasing a person would require a service-role operation, and payroll lines reference `people(id)` with **no cascade**, deliberately, so a closed snapshot cannot silently disappear. Erasure and payroll immutability are in direct tension and need a decided policy |
| R-4 | What is the lawful basis for processing wage and contact data, and is a notice to staff required? | Nothing in the system records a basis or a notice |
| R-5 | Are there cross-border transfer implications (Supabase/Vercel regions vs. where staff are employed)? | Not established. Provider regions are not documented in this repo |
| R-6 | What must a payslip or payroll record contain to be valid, and does the current snapshot satisfy it? | The close records gross only. **No tax, no social insurance, no deductions, no net pay** — explicitly out of scope (SPEC-0006 §3) |
| R-7 | Who is the data controller, and is a processor agreement with Supabase/Vercel required or in place? | Not established |
| R-8 | What is the retention and access policy for backups containing staff PII? | Not established — see L-7 |
| R-9 | What is the breach-notification obligation and to whom? | No incident-response procedure exists for this system |
| R-10 | Is a written data-protection impact assessment required before processing real staff pay data? | Not established. **This document is a technical access review, not a DPIA**, and must not be presented as one |

---

## 12. Go / no-go checklist for real payroll data

Two lists, deliberately separated. **A green technical column does not authorise anything.** Real
payroll data may be imported only when **every** item in both columns is satisfied and §13 is signed.

### 12.1 Technical gates — automatable, and their current state

| # | Gate | How it is checked | State |
|---|---|---|---|
| G-T1 | Wages readable only by owner/accountant, same org | pgTAP `46`, **`142`** | ✅ verified locally |
| G-T2 | Payroll runs/lines readable only by owner/accountant, same org, **directly through the table** | pgTAP **`142`** | ✅ verified locally |
| G-T3 | Contact PII denied to every app role, owner and accountant included | pgTAP `48`, **`142`** | ✅ verified locally |
| G-T4 | Cross-org denial on every payroll/PII table for a legitimate `payroll.read` holder | pgTAP **`142`** | ✅ verified locally |
| G-T5 | `anon` holds no table DML and cannot execute the close or any guard/internal function | pgTAP `80`, `97_grant_hygiene`, `22` INV-1, `20260729090000`, **`142`**; hosted probe §9.1 | ✅ locally · ✅ **hosted for the payroll/PII surface** (L-1: no `anon` grant rows on `labor_logs`/`payroll_runs`/`payroll_run_lines`; `people_compensation` no read/DML, `REFERENCES`+`TRIGGER` residual only — F-1. L-11: no `anon`/`authenticated` EXECUTE on either `private` payroll internal) · ⚠️ hosted `anon` EXECUTE on the **public** definer functions (the close and the trigger guards) not probed — pinned locally by `22` INV-1 only |
| G-T6 | Payroll close permitted only to owner/accountant and never with a caller-supplied foreign org | pgTAP `20260729090000` | ✅ verified locally |
| G-T7 | Audit rows for compensation and payroll do not reach non-payroll roles; vocabulary pin complete | pgTAP `53`, `56`, **`131`**, `20260729090000` | ✅ verified locally |
| G-T8 | `labor_logs` role gates match spec; cross-org write **and read** denied; table stays money-free | pgTAP `114`, `115`, **`142`** | ✅ verified locally |
| G-T9 | Import readiness owner/accountant gate; commit refused **before body parse**; no contact columns; no PII echo | Vitest `import/access.test.ts`, `descriptors/payroll-readiness.test.ts` | ✅ verified |
| G-T10 | Assistant policy denies payroll and contact data | Vitest `assistant-policy.test.ts` | ✅ verified |
| G-T11 | App pages and nav role gates align with the DB; no route or query bypass; no `people` projection selects phone/email or `*` | Vitest `payroll-surface`, `payroll-readiness-surface`, `attendance-surface`, **`people-pii-access-surface`** | ✅ verified |
| G-T12 | Fixed error messages; no raw DB text; no `console.*` on any people/payroll path | Vitest `payroll-surface`, source review §6.10 | ✅ verified |
| G-T13 | Payroll snapshot immutable; closed periods freeze their labor rows | pgTAP `20260729090000` | ✅ verified locally |
| G-T14 | Full suite green: pgTAP, Vitest, `tsc`, ESLint, `npm run build`, `git diff --check` | §8.3 + §14 | ✅ this run |
| G-T15 | **Hosted** RLS/FORCE/grant/policy state matches the ledger; live deny path verified with a real supervisor JWT | L-1 … L-4, L-11 | ⚠️ **PARTIAL** — ✅ L-1 (`anon` grants), ✅ L-2 (RLS **and** FORCE true on all five tables), ✅ L-4 (migration head and five policy predicates match the ledger), ✅ L-11 (`private` payroll internals hold no client EXECUTE); ❌ **L-3 live JWT deny path NOT DONE**. The gate stays **open**: metadata is not behaviour |
| G-T16 | `custom_access_token_hook` verified before any second org | L-5 | ❌ **NOT DONE** |
| G-T17 | Leaked-password protection enabled; advisor clean | L-10 | ❌ **NOT DONE** |
| G-T18 | Log/backup retention and access understood for payroll requests | L-6, L-7 | ❌ **NOT DONE** |
| G-T19 | Service-role secret absent from repository artefacts, client import graph, local browser build and referenced production chunks | L-8; `scripts/check-service-role-exposure.mjs`; CI | ✅ **verified at the 2026-07-29 snapshot; repository/graph/local-build arms enforced in CI** |

### 12.2 Human gates — only the independent technical review is satisfied

| # | Gate | Who | State |
|---|---|---|---|
| G-H1 | **Independent access review** of this packet by a reviewer who is **not** its author (SPEC-0006 §4.1, `CLAUDE.md`) | Independent reviewer | ✅ **DONE 2026-07-29** — OpenAI Codex reviewed Claude's authored packet, required two harness corrections, re-ran the complete evidence, and recorded the conditional verdict in §13.1 |
| G-H2 | **Written Stage-M privacy approval** from a **separate approver** who is not the actor that produced the change | Owner / data approver | ❌ **NOT DONE** |
| G-H3 | Approved, named **source** for real roster / rate / labor data, with its provenance recorded | Owner | ❌ **NOT DONE** |
| G-H4 | Every production `owner`/`accountant` account is a real, named, individually-owned, recoverable account; the retired shared password is confirmed dead on every identity (`SECURITY-NOTES.md` §5.1) | Owner | ❌ **NOT DONE — blocking** |
| G-H5 | Staff informed as required; lawful basis and notice settled (§11 R-4) | Owner + adviser | ❌ **NOT DONE** |
| G-H6 | Handling rule agreed for **printed** payroll reports and for screens visible to others | Owner | ❌ **NOT DONE** |
| G-H7 | Contact-PII visibility policy **ratified** (deny-by-default confirmed, or an owner-gated read RPC commissioned and separately reviewed) — F-3 | Owner | ❌ **NOT DONE** |
| G-H8 | `labor_logs` classification **ratified** as operational, or reclassified to payroll-confidential — F-5 | Owner | ❌ **NOT DONE** |
| G-H9 | Retention, erasure and backup policy decided (§11 R-1, R-2, R-3, R-8) | Owner + adviser | ❌ **NOT DONE** |
| G-H10 | Legal review of payroll-record obligations for the operating jurisdiction (§11 R-6, R-10) | Qualified adviser | ❌ **NOT DONE** |
| G-H11 | Explicit, written **payment / journal scope decision** (in or out, and if in, its own spec and review) | Owner | ❌ **NOT DONE** |
| G-H12 | Authenticated owner/accountant pilot of compensation → attendance → close → report on **synthetic** data, with dated evidence, **before** any real import | Owner + accountant | ❌ **NOT DONE** |
| G-H13 | Dated acceptance signoff by Owner **and** accountant after the pilot | Owner + accountant | ❌ **NOT DONE** |

**Decision rule.** Real staff PII may enter any environment only when: every G-T item is ✅ *including*
G-T15…G-T19; **and** every G-H item is signed; **and** §13 below carries two real signatures on two
real dates. Until then the standing answer is **NO-GO**. G-H1 is complete; the next approval action is
G-H2, while the remaining technical and operator gates must also close.

**What the 2026-07-29 hosted probe changed, and what it did not.** It closed **F-1** (verified clean,
no migration needed) and moved **L-1, L-2, L-4 and L-11** to done, which upgrades G-T5 and takes G-T15
from ❌ to ⚠️ partial. **It changes the standing answer not at all.** G-T15 still fails on L-3;
G-T16, G-T17 and G-T18 are untouched. G-H1 is now satisfied by the independent review below, but
**the other twelve human gates in §12.2 remain unsatisfied**. The verdict is **NO-GO**, unchanged.

---

## 13. Signoff

**The independent reviewer block is complete. The Owner/data-approver block remains unsigned. Do not
fill any field on behalf of another person.**

### 13.1 Independent access reviewer

> Confirms: they are not the author of the changes reviewed; they re-ran §1.4 themselves; they read
> §8 against the cited sources; and they record their own verdict on §10 F-1 (including whether live
> check L-1 was run and what it returned).

| Field | Value |
|---|---|
| Name | OpenAI Codex |
| Role / independence basis | Independent technical reviewer; Claude authored the implementation and first review packet |
| Re-ran §1.4 (pgTAP / Vitest / tsc / build) | Yes — pgTAP 3101/0/0; Vitest 1232 passed + 13 skipped; TypeScript clean; touched ESLint clean; production build 64/64 |
| L-1 hosted `anon` grant probe run? | Yes — no rows for `labor_logs`, `payroll_runs`, `payroll_run_lines`; `people_compensation` has only the documented non-read/non-DML `REFERENCES` and `TRIGGER` residual |
| Verdict on F-1 | No migration needed; hosted state verified clean |
| Findings added or disputed | Required per-reader scanner non-vacuity and direct `people_compensation` RLS coverage for all six roles; both corrected and re-verified. Closed F-2 by reconciling the permissions matrix. |
| Overall verdict | **Access design accepted with conditions** — L-3, L-5…L-7, L-9…L-10, G-T16…G-T18, and G-H2…G-H13 remain open; no real payroll data authorised |
| Date | 2026-07-29 |
| Signature | OpenAI Codex independent review attestation (not Owner/data-approver approval) |

### 13.2 Owner / data approver (separate approver — Stage M)

> Confirms the human gates in §12.2 that are theirs to confirm, and authorises (or does not authorise)
> real staff PII to enter the system. **This signature is the only thing that can change the standing
> NO-GO.**

| Field | Value |
|---|---|
| Name | ☐ ______________________ |
| Confirms they are NOT the actor that produced the change | ☐ ______________________ |
| G-H3 approved source named | ☐ ______________________ |
| G-H4 account hygiene confirmed | ☐ ______________________ |
| G-H7 contact-PII policy ratified as | ☐ deny-by-default ☐ owner-gated RPC commissioned |
| G-H8 labor classification ratified as | ☐ operational (C2) ☐ payroll-confidential (C3) |
| G-H11 payment / journal scope | ☐ out of scope ☐ in scope (separate spec + review required) |
| Decision | ☐ real payroll data AUTHORISED ☐ NOT authorised ☐ authorised with conditions: __________ |
| Date | ☐ __________ |
| Signature | ☐ ______________________ |

---

## 14. Validation record for this packet

| Check | Command | Result |
|---|---|---|
| pgTAP (full harness) | `bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh` | **3101 ok, 0 not_ok, 0 file_failures** (baseline before this work: 3067 / 0 / 0) |
| App Vitest (full) | `npx vitest run` | **90 files, 1232 passed, 13 skipped** (baseline, this file excluded: 89 / 1219 / 13) |
| TypeScript | `npx tsc --noEmit` | clean |
| ESLint (touched) | `npx eslint lib/people-pii-access-surface.test.ts` | clean, 0 errors |
| Production build + guards | `npm run build` | see §15 |
| Hosted security advisor | Supabase security advisor, production project | leaked-password protection still disabled; L-10 remains open |
| Whitespace | `git diff --check` | clean |

**Files changed by this review**

| File | Change |
|---|---|
| `docs/payroll privacy access review.md` | new — this document |
| `apps/farm-os/supabase/tests/142 payroll access review evidence test.sql` | new — 34 assertions (§8.2 N-1) |
| `apps/farm-os/lib/people-pii-access-surface.test.ts` | new — 13 cases (§8.2 N-2) |
| `apps/farm-os/supabase/tests/131_audit_read_sensitive_pin_test.sql` | extended vocabulary (§8.2 N-3) |
| `docs/PERMISSIONS-MATRIX.md` | reconciled to the final people/labor/payroll permission and route surface (F-2) |

**No migration was written. No schema, RLS policy, grant, RPC or application behaviour was changed.**
F-1's proposed `revoke` was withdrawn after live check L-1 verified the hosted grant state clean; no
schema change is needed.

---

## 15. Related documents

- `docs/SPEC-0006-people-labor-payroll.md` — the ratified scope and its acceptance oracle
- `docs/MASTER-PLAN.md` §4 Stage 8, Stage M; §6 risk #5
- `docs/SECURITY-NOTES.md` — §0.1 (`custom_access_token_hook`), §1.4 (leaked-password), §4.3 (Stage M
  boundary), §5.1 (live demo identities — open)
- `docs/PILOT-READINESS.md` § Payroll preparation — the ten-gate human checklist
- `docs/PERMISSIONS-MATRIX.md` — reconciled to the final people/labor/payroll surface by F-2
- `docs/CLAUDE.md` — Owner & approvals, hard stops, independent-review requirement
- `docs/SESSION-BRIEF.md` — the 2026-07-29 entries and their truth boundaries
