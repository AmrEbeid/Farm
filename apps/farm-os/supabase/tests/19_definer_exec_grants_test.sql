-- 19 — GRANT-C1 follow-up (migration 0021): SECURITY DEFINER functions are locked to the roles
-- that actually call them.
--
-- On Supabase, default privileges auto-GRANT EXECUTE to anon/authenticated on every new public
-- function, and a `revoke ... from public` does NOT remove an explicit anon/authenticated grant.
-- The prod-push assurance confirmed anon could reach the write RPCs, and PUBLIC could reach the
-- trigger functions, via /rest/v1/rpc/*. Migration 0021 revokes those grants. This pins the end
-- state so a future definer function that forgets its lockdown is caught by CI.
--
-- Catalog-level privilege checks (has_function_privilege) — independent of RLS, so they are valid
-- even on the local superuser cluster where FORCE RLS cannot be exercised. Run via `supabase test db`.

begin;
select plan(9);

-- ===== authenticated-only write RPCs: anon must NOT execute; authenticated MUST =====
select ok(not has_function_privilege('anon',
  'public.fn_execute_operation(uuid, numeric, int, text)', 'EXECUTE'),
  '0021: anon cannot EXECUTE fn_execute_operation');
select ok(has_function_privilege('authenticated',
  'public.fn_execute_operation(uuid, numeric, int, text)', 'EXECUTE'),
  '0021: authenticated CAN EXECUTE fn_execute_operation (the legitimate op.execute gate)');
select ok(not has_function_privilege('anon',
  'public.fn_post_movement(uuid, text, numeric, text, text, numeric, uuid, uuid, uuid, timestamptz)', 'EXECUTE'),
  '0021: anon cannot EXECUTE fn_post_movement');

-- ===== trigger functions: no client role should hold EXECUTE (never called directly) =====
select ok(not has_function_privilege('anon', 'public.pr_guard_approval()', 'EXECUTE'),
  '0021: anon cannot EXECUTE pr_guard_approval (trigger fn)');
select ok(not has_function_privilege('authenticated', 'public.pr_guard_approval()', 'EXECUTE'),
  '0021: authenticated cannot EXECUTE pr_guard_approval (trigger fn)');
select ok(not has_function_privilege('anon', 'public.fn_audit()', 'EXECUTE'),
  '0021: anon cannot EXECUTE fn_audit (trigger fn)');
select ok(not has_function_privilege('authenticated', 'public.fn_audit()', 'EXECUTE'),
  '0021: authenticated cannot EXECUTE fn_audit (trigger fn)');
select ok(not has_function_privilege('anon', 'public.fn_audit_org_member()', 'EXECUTE'),
  '0021: anon cannot EXECUTE fn_audit_org_member (trigger fn)');
select ok(not has_function_privilege('authenticated', 'public.fn_audit_org_member()', 'EXECUTE'),
  '0021: authenticated cannot EXECUTE fn_audit_org_member (trigger fn)');

select * from finish();
rollback;
