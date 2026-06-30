-- 104 — least-privilege invariant: the anon role must NOT execute the action RPCs (advisor lint 0028;
-- fixed by migration 0100). End-state assertion (the prod gap is a Supabase platform-default grant that
-- the Docker-free harness does not reproduce, so this is a state invariant, not a before/after gate —
-- same style as test 97 for table-grant hygiene). authenticated must retain EXECUTE (the app path).
-- Run via test-shims/run-pgtap-local.sh.
begin;
select plan(4);

select ok(
  not has_function_privilege('anon', 'public.fn_set_active_org(uuid)', 'EXECUTE'),
  'anon cannot execute fn_set_active_org (action RPC, not an RLS helper)');
select ok(
  not has_function_privilege('anon', 'public.fn_update_org_settings(uuid,text,text,text,text,date)', 'EXECUTE'),
  'anon cannot execute fn_update_org_settings (owner-only org-settings write)');

select ok(
  has_function_privilege('authenticated', 'public.fn_set_active_org(uuid)', 'EXECUTE'),
  'authenticated retains EXECUTE on fn_set_active_org (the app path is unchanged)');
select ok(
  has_function_privilege('authenticated', 'public.fn_update_org_settings(uuid,text,text,text,text,date)', 'EXECUTE'),
  'authenticated retains EXECUTE on fn_update_org_settings');

select * from finish();
rollback;
