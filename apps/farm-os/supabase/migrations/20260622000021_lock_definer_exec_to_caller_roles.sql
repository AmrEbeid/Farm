-- Farm OS MVP-0 — GRANT-C1 follow-up: lock SECURITY DEFINER functions to the roles that call them.
--
-- On Supabase, default privileges auto-GRANT EXECUTE to anon/authenticated on every new function
-- created in the `public` schema. The per-migration `revoke ... from public` in 0011/0017/0019/0020
-- does NOT remove those grants, because they are explicit grants to the anon/authenticated *roles*,
-- not to PUBLIC. Result (confirmed live + by the Supabase advisor 0028/0029): anon could reach the
-- write RPCs and the trigger functions via /rest/v1/rpc/*. Not exploitable today (fn_execute_operation
-- and fn_post_movement reject anon in-body via authorize()/org guards, and trigger functions error
-- outside trigger context), but the grant layer is looser than intended. Close it explicitly.
--
-- The 0010 blanket `revoke execute ... on all functions ... from anon` only covered functions that
-- existed at that time (it caught fn_stock_coverage); functions created afterwards need their own
-- anon revoke — that is what this migration adds, generalising the pattern.

-- Authenticated-only write RPCs (in-body authorize() already the real gate; this is defense in depth).
revoke execute on function public.fn_execute_operation(uuid, numeric, int, text) from anon;
revoke execute on function public.fn_post_movement(
  uuid, text, numeric, text, text, numeric, uuid, uuid, uuid, timestamptz) from anon;

-- Trigger functions — never invoked directly; no client role should hold EXECUTE.
-- Revoke from PUBLIC *and* anon/authenticated: depending on provisioning order these carry either a
-- PUBLIC grant (=X in proacl) or an explicit authenticated grant (from the 0009 blanket grant), so
-- both must be removed for the lockdown to hold on a fresh DB as well as on the existing prod DB.
revoke execute on function public.pr_guard_approval()   from public, anon, authenticated;
revoke execute on function public.fn_audit()            from public, anon, authenticated;
revoke execute on function public.fn_audit_org_member() from public, anon, authenticated;
