-- 108 — #216 unit reconciliation, demand side (migration 20260701170000). A trigger on
-- plan_material_requirements DEFAULTS a null unit to the item's canonical unit and REJECTS a non-null
-- mismatch, so the engine's unit-blind demand sum can't be masked by a wrong-unit requirement (a 'ton'
-- requirement reading as its raw number). Run via test-shims/run-pgtap-local.sh.
-- NOTE: no inline comment on \set lines — psql appends the rest of the line into the value.
-- K = سلفات بوتاسيوم (kg); L = مبيد فطري (L); OP = a seed plan_operation; ORG = seed org.
\set K '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set L '21f793b6-58f8-5607-9b0b-49581ae52b27'
\set OP '37c9cce6-6ec4-570a-97a4-b263e2faf5d0'
\set ORG '00000000-0000-0000-0000-000000000001'

begin;
select plan(3);

-- 1) a requirement whose unit differs from the item's canonical unit is REJECTED (would mask a shortage:
--    0.5 'ton' summed unit-blind reads as 0.5 instead of 500)
select throws_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, 0.5, 'ton') $$, :'ORG', :'OP', :'K'),
  '22023', null, '#216: a ton requirement on a kg item is rejected (would mask a shortage)');

-- 2) a null unit inherits the item's canonical unit (default, not a hardcoded 'kg')
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'ORG', :'OP', :'L', 5, null);
select is(
  (select unit from public.plan_material_requirements where item_id = :'L' order by ctid desc limit 1),
  'L', '#216: a null-unit requirement inherits the item unit (L)');

-- 3) a matching unit is accepted
select lives_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, 10, 'kg') $$, :'ORG', :'OP', :'K'),
  '#216: a matching kg requirement is accepted');

select * from finish();
rollback;
