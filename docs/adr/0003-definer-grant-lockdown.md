# 0003 — SECURITY DEFINER grant lockdown on Supabase

- **Status:** Accepted — 2026-06-22
- **Implementation:** `apps/farm-os/supabase/migrations/20260622000021_lock_definer_exec_to_caller_roles.sql`
- **Oracles:** `apps/farm-os/supabase/tests/19_definer_exec_grants_test.sql`,
  `apps/farm-os/supabase/tests/22_security_invariants_test.sql`

## Context

On Supabase, default privileges auto-`GRANT EXECUTE` to `anon` and `authenticated` on
every new function created in the `public` schema. The per-migration
`revoke … from public` in 0011/0017/0019/0020 does **not** remove those grants, because
they are explicit grants to the `anon`/`authenticated` *roles*, not to `PUBLIC`.

Confirmed live and by the Supabase advisor (0028/0029): `anon` could reach the write RPCs
(`fn_execute_operation`, `fn_post_movement`) and the trigger functions
(`pr_guard_approval`, `fn_audit`, `fn_audit_org_member`) via `/rest/v1/rpc/*`. Not
exploitable in itself — the write RPCs reject `anon` in-body via `authorize()`/org guards,
and trigger functions error outside trigger context — but the grant layer was looser than
intended, and the 0010 blanket revoke only covered functions that existed at the time.

## Decision

Explicitly claw back the unintended grants, generalising the pattern:

- `REVOKE EXECUTE … FROM anon` on the authenticated-only write RPCs
  (`fn_execute_operation`, `fn_post_movement`).
- `REVOKE EXECUTE … FROM public, anon, authenticated` on the trigger functions — they are
  never invoked directly, so no client role should hold EXECUTE. Revoking from all three
  covers either provisioning order (a PUBLIC grant or an explicit role grant).

Pin the end state with two oracle layers so a future definer function that forgets its
lockdown is caught in CI:

- **Test 19** pins the specific functions/findings by name.
- **Test 22** asserts *catalog-level* invariants dynamically (count of violations = 0), so
  they auto-extend to new objects: no public `SECURITY DEFINER` function is anon-executable
  except the RLS helpers `authorize(text)` / `user_org_ids()`; `authenticated` may execute
  only the intended RPC surface; no definer trigger function is client-executable. (It also
  asserts RLS is enabled on every base table and partition child.)

## Consequences

- **Positive:** the grant layer now matches intent (defense in depth behind the in-body
  gates); a regression is caught at the catalog level regardless of which migration adds
  the next function. The two intended RLS helpers are explicitly pinned as anon-executable
  so an over-zealous future revoke that breaks anonymous RLS evaluation is also caught.
- **Negative / trade-offs:** any new `SECURITY DEFINER` function must remember to revoke the
  default grant and, if it is a legitimate authenticated RPC, be added to the test-22
  allow-list — otherwise CI fails. This is the intended friction.
