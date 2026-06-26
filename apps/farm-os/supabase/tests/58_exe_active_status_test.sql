-- 58 — #235: fn_execute_operation must refuse a TERMINAL operation. The guard previously only
-- special-cased `done` (claim-first → 23505), so a blocked / abandoned / skipped op could still be
-- executed — issuing stock, costing labor, and flipping the cancelled op to done. 0057 adds an
-- executable-status guard (22023) for those three terminal statuses, evaluated after authz/org and
-- before the claim. The happy path (an active op executes) stays covered by tests/18. Impersonation via
-- request.jwt.claims (owner holds op.execute). Ops seeded as superuser.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set plan 'eeee0058-0000-0000-0000-0000000000a1'
\set opB  'eeee0058-0000-0000-0000-0000000000b1'
\set opA  'eeee0058-0000-0000-0000-0000000000b2'
\set opS  'eeee0058-0000-0000-0000-0000000000b3'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');
insert into public.plan_operations (id, org_id, plan_id, subtype, status) values
  (:'opB', :'orgA', :'plan', 'fertilization', 'blocked'),
  (:'opA', :'orgA', :'plan', 'fertilization', 'abandoned'),
  (:'opS', :'orgA', :'plan', 'fertilization', 'skipped');

-- act as the owner (holds op.execute), so the throw is the status guard (22023), not authz (42501)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ select public.fn_execute_operation(%L, 1, 1, 'x') $$, :'opB'),
  '22023', null,
  '#235: a BLOCKED op is not executable (fn_execute_operation refuses, no stock issued)');

select throws_ok(
  format($$ select public.fn_execute_operation(%L, 1, 1, 'x') $$, :'opA'),
  '22023', null,
  '#235: an ABANDONED op is not executable');

select throws_ok(
  format($$ select public.fn_execute_operation(%L, 1, 1, 'x') $$, :'opS'),
  '22023', null,
  '#235: a SKIPPED op is not executable');

reset role;

-- the three terminal ops were NOT flipped to done (the refusal had no side effect)
select is(
  (select count(*)::int from public.plan_operations
     where id in (:'opB', :'opA', :'opS') and status = 'done'),
  0,
  '#235: the refused executions left the terminal ops unchanged (none flipped to done)');

select * from finish();
rollback;
