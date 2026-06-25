# SPEC-0002 — Complete RLS authorization enforcement (close AUTHZ-1 / role posture)

*Status: **DRAFT for Owner review** — design + decision-support only. No code, no migration, no
policy change is made by this document. Access-control changes are Owner-gated and require
independent review per PROJECT RULES. This spec exists so the Owner can ratify a direction before
any enforcement migration is written.*

*Scope owner workstream — companion to `SECURITY-REVIEW-FOLLOWUP-2026-06-25.md` (findings AUTHZ-1,
the §45 direct-DELETE posture, AUDIT-1) and `SPEC-0001` (the engine). Generalises the **already
proven** B2 pattern in migration `0015`.*

---

## 1. The role model already exists — the gap is *coverage*, not *design*

A common misread (including in our own "needs the role model" deferrals) is that Farm OS lacks a
role model. It does not. Migration `0001` already ships the whole RBAC spine:

- **Six roles** on `organization_member.role`:
  `owner · farm_manager · agri_engineer · accountant · storekeeper · supervisor`.
- **A permission map**, `public.authorize(perm text)` (SECURITY DEFINER, locked `search_path`),
  that resolves a permission to the roles that hold it:

  | permission | roles |
  |---|---|
  | `pr.approve` | owner |
  | `plan.write` | owner, farm_manager |
  | `op.execute` | owner, farm_manager, agri_engineer, supervisor |
  | `inventory.write` | owner, farm_manager, storekeeper |
  | `budget.write` | owner, accountant |

- **The enforcement idiom**: RLS policies call `authorize('…')` in `WITH CHECK` rather than
  hard-coding roles, so the map is the single source of truth (build spec §8).

So the question is **not** "what is the role model" — it is **"which write paths actually call
`authorize()`, and which still rely only on org membership (`tenant_all`)?"** Today the answer is
uneven, and that unevenness *is* AUTHZ-1.

### What is enforced today

| Path | Policy today | Role-gated? |
|---|---|---|
| PR approval (`pr_update`) | AP-1 `authorize('pr.approve')` + AP-5 SoD trigger (`0017`) | ✅ yes |
| Inventory direct writes (`inventory_bin`, `inventory_movements`) | `0015` `tenant_all` + `WITH CHECK authorize('inventory.write')` | ✅ yes |
| **Operation execution** (`farm_event`(+partitions), `event_locations`, `quantities`, `plan_operations`) | org-only `tenant_all` (`0004`/`0006`) — `WITH CHECK (org_id in user_org_ids())` | ❌ **no** ← **AUTHZ-1** |
| Other tenant tables (28 total) — direct **DELETE** | org-only `tenant_all` `USING` | ❌ no ← §45 posture |
| `organization_member` (role grants) | write-locked; **now audited** via PR #68 (AUDIT-1) | n/a (audit) |

---

## 2. AUTHZ-1, precisely (grounded in the code)

`executeOperation` (`app/(app)/m/execute/[opId]/actions.ts`) records a planned operation as done.
Its docstring claims *"RLS-scoped (op.execute role: supervisor/engineer/manager/owner)"*, but the
action only calls `requireMembership()` — it **never calls `authorize('op.execute')`**, and the
tables it writes directly carry the org-only `tenant_all` policy:

- `plan_operations` — claim-first `status → done` (the EXE-1 idempotency gate)
- `farm_event` (+ monthly partition children) — the `done` event
- `event_locations` — where it happened
- `quantities` — the negative `inventory_adjustment` (consumption)
- *(stock movement goes through `fn_post_movement`, a SECURITY DEFINER **bypassrls** RPC — already
  the gated path, not part of this gap)*

**Consequence:** any authenticated org member — including an `accountant` or `storekeeper` who has
no `op.execute` permission — can mark operations done (and thereby drive stock issue) either through
the app action or directly via `POST /rest/v1/farm_event` etc. The permission exists; nothing
checks it. **Severity LOW–MED**: single reference tenant today, conservative blast radius, but it is
a real claim-vs-reality gap and a multi-tenant blocker.

---

## 3. The proven pattern (B2 / migration `0015`)

`0015` closed the identical shape for inventory and is the template to generalise:

```sql
create policy tenant_all on public.inventory_movements for all to authenticated
  using      (org_id in (select public.user_org_ids()))                          -- reads stay org-open
  with check (org_id in (select public.user_org_ids())
              and public.authorize('inventory.write'));                          -- writes role-gated
```

Three properties make it safe and worth copying:
1. **Reads stay org-open** (`USING` unchanged) → dashboards and the engine keep working for *every*
   role.
2. **A single `FOR ALL` policy** (not a split) keeps PostgREST embedding happy; the role check lives
   in `WITH CHECK`, so it applies to INSERT/UPDATE only (DELETE is governed by `USING` — see §5).
3. **App writes route through a bypassrls RPC** (`fn_post_movement`), so legitimate execution by
   roles *without* the direct-write permission is unaffected — only ad-hoc direct-table writes are
   gated.

Property 3 is the crux of the design choice below: inventory had an RPC to hide behind. The
operation tables **do not** — `executeOperation` writes them directly.

---

## 4. The real design tension — these tables are multi-writer

A blanket `WITH CHECK (... and authorize('op.execute'))` on the operation tables is **not** a safe
copy-paste, because the same tables are written by flows other than execution:

- **`plan_operations`** is written by **planning** (`plan.write` → owner/farm_manager), not only by
  execution. Gating all its writes on `op.execute` could break the plan-authoring path (and the
  permission sets differ: a `farm_manager` has both, but an `agri_engineer`/`supervisor` has
  `op.execute` and *not* `plan.write`, while planning may be done by roles that lack `op.execute`).
- **`farm_event` / `event_locations` / `quantities`** back **every** event type (irrigation,
  inspection, fertigation, …), not just executed operations. Other event-recording flows write them.

So "add `authorize('op.execute')` to these tables" risks **over-gating** (breaking planning / other
event capture) or **under-gating** (if we carve exceptions, the gate leaks). This is the decision
that needs the Owner, not a mechanical migration.

---

## 5. Options (with a recommendation)

### Option A — Route execution through a bypassrls RPC, gate inside it *(recommended)*
Mirror inventory exactly: introduce `fn_execute_operation(...)` (SECURITY DEFINER, bypassrls) that
performs the claim-first flip + event/locations/quantities inserts + the `fn_post_movement` calls as
one transaction, with `if not authorize('op.execute') then raise` at the top. `executeOperation`
calls the RPC instead of issuing five direct writes.
- **Pros:** the permission is enforced server-side regardless of REST access; the operation tables
  keep their org-only `tenant_all` (no multi-writer breakage); execution becomes **atomic** (today
  the five writes are non-transactional — a partial failure can desync, the very class EXE-1/RCP-1
  fought); composes with the existing claim-first idempotency.
- **Cons:** larger change (a new RPC + action rewrite); the operation tables remain *directly*
  writable by any org member via REST (mitigated by §45 Option below / the role posture), so this
  closes the *app* path strongly but not the *direct-REST* path for these tables.
- **Review tier:** money/inventory + engine-adjacent → independent review + pgTAP + the Playwright
  wedge-loop (execution is step 8 of the core loop).

### Option B — Gate the tables directly in `WITH CHECK`
Add `and authorize('op.execute')` to the operation tables' `tenant_all`, and resolve §4 by
**splitting** the permission (e.g. a distinct `event.write` for general event capture vs.
`op.execute` for marking a planned operation done) and assigning `plan_operations` writes correctly.
- **Pros:** closes the direct-REST path too; no RPC.
- **Cons:** requires getting the permission split + per-table assignment exactly right or it breaks
  planning / event capture; more policy surface to reason about; still leaves execution
  non-transactional.
- **Review tier:** as above.

### Option C — App-layer check only (`authorize` read in the action)
Add an `authorize('op.execute')` membership check at the top of `executeOperation`.
- **Pros:** one-line, zero migration.
- **Cons:** **violates the project non-negotiable** that isolation/authorization is enforced in
  Postgres, not only the app layer — direct REST bypasses it entirely. **Defense-in-depth only, not
  a fix.** Acceptable *in addition to* A/B, never instead.

**Recommendation: Option A**, with the app-layer check (C) added as defense-in-depth. It matches the
inventory precedent, makes execution atomic (a latent integrity win beyond AUTHZ-1), and keeps the
multi-writer tables' policies untouched. Pair it with the §45 direct-DELETE posture decision below
so the residual direct-REST surface on these tables is addressed coherently rather than piecemeal.

### Related: the §45 direct-DELETE posture (28 tables)
Independently of execution, `tenant_all`'s `USING` clause lets any org member **DELETE** rows across
28 tenant tables via REST (the app only deletes `plan_checks` as a client). Tiered remediation
(documented in `SECURITY-FINDING-delete-exposure-2026-06-25.md`): (1) `revoke delete … from
authenticated` on append-only/ledger tables (as `0016` did for the stock ledger); (2) role-gate
DELETE where a delete is legitimate; (3) leave truly client-deletable tables open. This is the same
"complete the enforcement coverage" workstream and should be ratified together.

---

## 6. Owner decision points

1. **Approach for AUTHZ-1:** Option A (RPC, recommended) vs. B (table gate) vs. defer.
2. **Permission granularity:** is one `op.execute` enough, or do we split `event.write` vs.
   `op.execute` (needed only under Option B)?
3. **Multi-tenant role policy:** confirm the `0001` role→permission map is the intended production
   posture (e.g. should `supervisor` execute? should `agri_engineer` plan?). The map is currently
   tuned to the single reference tenant.
4. **§45 DELETE tiering:** which of the 28 tables move to append-only / role-gated / open.
5. **Sequencing:** these are migrations `0019+`, applied to prod only via the (now-documented)
   DEPLOY-RUNBOOK §1a incremental-push step, after `0015→0018` land.

## 7. Test plan (when an approach is chosen)
- pgTAP: a non-`op.execute` role (e.g. `accountant`) **cannot** execute an operation (direct write
  or RPC rejected); an `op.execute` role **can**; planning by `plan.write` roles is **unbroken**
  (regression guard for §4). Mirror the `0010`/`0012`/`0015` test style.
- Playwright wedge-loop re-run (execution is loop step 8).
- Confirm reads remain org-open for all roles (no dashboard/engine regression).
- AUDIT-1 (PR #68) already covers auditing of the role grants this spec relies on.

---

*No enforcement is changed here. Next step is an Owner decision on §6; only then is migration `0019`
written, independently reviewed, and pgTAP/e2e-verified before the gated prod push.*
