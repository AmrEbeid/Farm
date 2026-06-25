# 0001 — AUTHZ-1 via an atomic `fn_execute_operation` RPC

- **Status:** Accepted — 2026-06-22
- **Spec:** `docs/SPEC-0002-authorization-enforcement.md` (Option A)
- **Implementation:** `apps/farm-os/supabase/migrations/20260622000020_fn_execute_operation.sql`

## Context

`executeOperation` ran the whole "execute an operation" flow as roughly five separate,
un-transactioned writes issued from the authenticated client (the `plan_operations`
status flip, the `farm_event` / `event_locations` / `quantities` inserts, and the
issue/release `fn_post_movement` calls). Two problems followed:

- **No real authorization (AUTHZ-1):** `op.execute` was only checked in the page and the
  app-layer guard. A role lacking `op.execute` could still execute by POSTing directly to
  the REST API, since the operation tables keep an org-only `tenant_all` policy.
- **No atomicity (EXEC-PARTIAL-1 / EXE-1 residual):** a partial failure mid-flow could
  desync state — e.g. a bin issued without its `quantities` row — and required fragile
  app-layer reverts.

SPEC-0002 weighed gating the tables directly (Option B) versus routing execution through
a `SECURITY DEFINER` RPC and gating inside it (Option A), and recommended Option A to
mirror the existing inventory precedent (`fn_post_movement`).

## Decision

Introduce `fn_execute_operation(p_op_id, p_actual_qty, p_labor_count, p_note)` as one
atomic `SECURITY DEFINER` RPC with `search_path = ''`, granted only to `authenticated`.
`executeOperation` calls this RPC instead of issuing direct writes.

- **Server-side gate:** the function's first action is
  `if not public.authorize('op.execute') then raise ... 42501`. `authorize()` reads
  `auth.uid()` from the JWT GUC, which `SECURITY DEFINER` does **not** change, so the
  caller's permission is evaluated even though the body runs as the definer. This is the
  single source of truth for `op.execute`, independent of REST access.
- **Atomicity:** the claim-first status flip, the event/locations/quantities inserts, and
  the issue/release movements all run in one transaction — any failure rolls everything
  back, so no app-layer revert is needed.
- **Idempotency:** the claim is `update … set status='done' where id=? and status<>'done'`;
  a second or concurrent call updates 0 rows and aborts (`23505`) before any stock moves.
- It also adds an org guard (defense in depth alongside RLS) and input range checks.

## Consequences

- **Positive:** `op.execute` is enforced regardless of REST access; execution is atomic
  and idempotent; the multi-writer operation tables keep their org-only policy (no
  multi-writer breakage). Pinned by pgTAP `tests/18_execute_operation_rpc_test.sql` and
  `tests/13_execute_idempotent_claim_test.sql`.
- **Negative / trade-offs:** the operation tables remain *directly* writable by any org
  member via REST — Option A closes the app path strongly but not the direct-REST surface
  on those tables (addressed coherently by the §45 delete-posture workstream). The RPC's
  signature and the `op.execute` permission name are now a contract the client depends on.
