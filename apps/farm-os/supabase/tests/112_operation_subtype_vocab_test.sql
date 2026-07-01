-- 112 — operation vocabulary (migration 20260701235000): plan_operations.subtype is constrained to
-- the real Egyptian date-palm operation set (the 5 pre-existing values + ~10 newly modeled ones —
-- pruning/dethorning, offshoot management, pollen collection, bunch limiting, thinning, bunch
-- tilting, bagging, pest scouting, harvest, post-harvest), and plan_operations.harvest_stage
-- (خلال/رطب/تمر) is constrained to its 3-value set. Covers: (a) a new-vocabulary subtype inserts,
-- (b) an out-of-vocabulary subtype is rejected, (c) a valid harvest_stage inserts, (d) an invalid
-- harvest_stage is rejected, (e) harvest_stage stays null for a non-harvest op (no cross-column
-- coupling is enforced — the column is simply optional). Run via `supabase test db` or
-- test-shims/run-pgtap-local.sh.

begin;
select plan(7);

\set orgA '00000000-0000-0000-0000-000000000001'
\set plan 'eeee0112-0000-0000-0000-0000000000a1'

insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');

-- (a) a newly-modeled subtype (not one of the original 5) inserts cleanly
select lives_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status)
            values (%L, %L, 'pruning_dethorning', 'planned') $$, :'orgA', :'plan'),
  '#operation-vocab: a new-vocabulary subtype (pruning_dethorning) inserts');

select lives_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status)
            values (%L, %L, 'post_harvest', 'planned') $$, :'orgA', :'plan'),
  '#operation-vocab: another new-vocabulary subtype (post_harvest) inserts');

-- (b) an out-of-vocabulary / typo'd subtype is rejected
select throws_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status)
            values (%L, %L, 'not_a_real_subtype', 'planned') $$, :'orgA', :'plan'),
  '23514', null,
  '#operation-vocab: an out-of-vocabulary subtype is rejected');

-- (c) a harvest op with a valid harvest_stage inserts
select lives_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status, harvest_stage)
            values (%L, %L, 'harvest', 'planned', 'rutab') $$, :'orgA', :'plan'),
  '#operation-vocab: harvest with a valid harvest_stage (rutab) inserts');

-- (d) an invalid harvest_stage is rejected
select throws_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status, harvest_stage)
            values (%L, %L, 'harvest', 'planned', 'overripe') $$, :'orgA', :'plan'),
  '23514', null,
  '#operation-vocab: an out-of-vocabulary harvest_stage is rejected');

-- (e) harvest_stage stays null for a non-harvest op — no cross-column CHECK enforced (by design)
select lives_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status, harvest_stage)
            values (%L, %L, 'irrigation', 'planned', null) $$, :'orgA', :'plan'),
  '#operation-vocab: harvest_stage null on a non-harvest op inserts');

select is(
  (select harvest_stage from public.plan_operations
     where plan_id = :'plan' and subtype = 'irrigation' limit 1),
  null,
  '#operation-vocab: harvest_stage is indeed null for the non-harvest op');

select * from finish();
rollback;
