-- Pin the anon-EXECUTE regression on authorize()/user_org_ids() closed (#229, migration 0039).
-- Catalog-level (has_function_privilege) — independent of RLS, mirrors test 19. This is the
-- regression guard: the next `create or replace` of either helper that forgets to re-revoke anon
-- will fail here. authenticated MUST keep EXECUTE (RLS policies evaluate these as the caller).

begin;
select plan(4);

select ok(not has_function_privilege('anon', 'public.authorize(text, uuid)', 'EXECUTE'),
  '0039: anon cannot EXECUTE authorize(text,uuid) (#229)');
select ok(has_function_privilege('authenticated', 'public.authorize(text, uuid)', 'EXECUTE'),
  '0039: authenticated CAN EXECUTE authorize(text,uuid)');

select ok(not has_function_privilege('anon', 'public.user_org_ids()', 'EXECUTE'),
  '0039: anon cannot EXECUTE user_org_ids() (#229)');
select ok(has_function_privilege('authenticated', 'public.user_org_ids()', 'EXECUTE'),
  '0039: authenticated CAN EXECUTE user_org_ids()');

select * from finish();
rollback;
