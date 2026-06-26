-- 59 — #235 (defense-in-depth, #298 review): plan_operations.status is constrained to its known
-- vocabulary. Before 0058 the column was free text, so a typo'd status could be written — and because
-- the execute guard / isExecutableOpStatus classify "executable" as NOT-IN {done,blocked,abandoned,
-- skipped}, an unknown status would be wrongly treated as executable. 0058 adds a CHECK to the 9-value
-- OP_STATUS_AR set. Inserts run as superuser — the CHECK is a table invariant. orgA + a plan from seed.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set plan 'eeee0059-0000-0000-0000-0000000000a1'

insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');

-- an unknown / typo'd status is rejected (the hole that would read as "executable")
select throws_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status)
            values (%L, %L, 'fertilization', 'cancled') $$, :'orgA', :'plan'),
  '23514', null,
  '#235: a typo''d plan_operations.status is rejected (would otherwise read as executable)');

-- each end of the vocabulary still inserts: a planned (active) and an approved op
select lives_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status)
            values (%L, %L, 'fertilization', 'approved') $$, :'orgA', :'plan'),
  '#235: a valid status (approved) still inserts');

select lives_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status)
            values (%L, %L, 'irrigation', 'skipped') $$, :'orgA', :'plan'),
  '#235: a valid terminal status (skipped) still inserts');

-- structural invariant
select is(
  (select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid
     where t.relname = 'plan_operations' and c.contype = 'c' and c.conname = 'plan_operations_status_valid'),
  1,
  '#235: plan_operations_status_valid CHECK is present');

select * from finish();
rollback;
