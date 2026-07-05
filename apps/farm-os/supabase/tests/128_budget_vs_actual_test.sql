-- 128 — budget vs actual, read-only (SPEC-0004 Slice A, migration 20260705130000).
-- Proves: finance.read gating + cross-org denial; live actuals rolled from the posted GL by expense category vs
-- SUM(budget_lines.planned); under/over-budget variance + flags; unbudgeted spend surfaced (not hidden); period
-- scoping (out-of-window expense excluded); posted-only (reversed entry drops out). Unique BVA-* categories avoid
-- the seed budget_lines; the seed posts no GL, so the actual side is deterministic.
begin;
select plan(16);

\set org '00000000-0000-0000-0000-000000000001'
\set otherOrg '00000000-0000-0000-0000-0000000000ff'
\set budget 'b0000000-0000-0000-0000-0000000000b1'
\set eFert 'e0000000-0000-0000-0000-0000000000f1'
\set eFuel 'e0000000-0000-0000-0000-0000000000f2'
\set eWater 'e0000000-0000-0000-0000-0000000000f3'
\set eOut 'e0000000-0000-0000-0000-0000000000f4'

select set_config('test.org', :'org', false);
select set_config('test.exp_acct', (select id::text from public.accounts where org_id=:'org' and code='5000'), false);
select set_config('test.cash', (select id::text from public.accounts where org_id=:'org' and code='1000'), false);
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner'      limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

-- budget: fertilizer 10,000 and fuel 5,000 planned (unique test categories)
insert into public.budgets (id, org_id, name, period) values (:'budget', :'org', 'BVA test', '2026');
insert into public.budget_lines (org_id, budget_id, category, planned) values
  (:'org', :'budget', 'BVA-fertilizer', 10000),
  (:'org', :'budget', 'BVA-fuel', 5000);

-- expenses carrying the category dimension (org-owned; category is what the report rolls up by)
insert into public.expenses (id, org_id, date, category, total, status) values
  (:'eFert',  :'org', '2026-03-05', 'BVA-fertilizer', 7000, 'approved'),
  (:'eFuel',  :'org', '2026-03-07', 'BVA-fuel',       6000, 'approved'),
  (:'eWater', :'org', '2026-03-09', 'BVA-water',      2000, 'approved'),
  (:'eOut',   :'org', '2026-06-01', 'BVA-fertilizer', 3000, 'approved');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.bva_field(cat text, field text) returns text language sql as $$
  select (e ->> field)
    from jsonb_array_elements(current_setting('test.bva')::jsonb -> 'lines') e
   where e ->> 'category' = cat
$$;

-- ── gating ────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon','public.fn_budget_vs_actual(uuid, date, date)','EXECUTE'),
  'anon cannot EXECUTE fn_budget_vs_actual');
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_budget_vs_actual(%L,'2026-03-01'::date,'2026-03-31'::date) $$, current_setting('test.org')),
  '42501', null, 'a supervisor (no finance.read) is denied budget-vs-actual');
reset role;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$ select public.fn_budget_vs_actual(%L,'2026-03-01'::date,'2026-03-31'::date) $$, :'otherOrg'),
  '42501', null, 'cross-org budget-vs-actual is denied');
reset role;

-- ── post the GL expenses (superuser); capture the fuel entry for the reversal test ───────────────────────────
select public.fn_post_two_line_journal(:'org','2026-03-05'::date,'bva_fert',gen_random_uuid(),'سماد',current_setting('test.exp_acct')::uuid,current_setting('test.cash')::uuid,7000,null,null,null,null,:'eFert');
select set_config('test.jw_fuel', public.fn_post_two_line_journal(:'org','2026-03-07'::date,'bva_fuel',gen_random_uuid(),'وقود',current_setting('test.exp_acct')::uuid,current_setting('test.cash')::uuid,6000,null,null,null,null,:'eFuel')::text, false);
select public.fn_post_two_line_journal(:'org','2026-03-09'::date,'bva_water',gen_random_uuid(),'ماء',current_setting('test.exp_acct')::uuid,current_setting('test.cash')::uuid,2000,null,null,null,null,:'eWater');
select public.fn_post_two_line_journal(:'org','2026-06-01'::date,'bva_out',gen_random_uuid(),'خارج الفترة',current_setting('test.exp_acct')::uuid,current_setting('test.cash')::uuid,3000,null,null,null,null,:'eOut');

-- ── the report for March 2026 (as accountant) ────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bva', public.fn_budget_vs_actual(current_setting('test.org')::uuid, '2026-03-01'::date, '2026-03-31'::date)::text, false);
reset role;

select is(pg_temp.bva_field('BVA-fertilizer','planned')::numeric, 10000::numeric, 'fertilizer planned = 10000');
select is(pg_temp.bva_field('BVA-fertilizer','actual')::numeric, 7000::numeric, 'fertilizer actual = 7000 (out-of-period 3000 excluded)');
select is(pg_temp.bva_field('BVA-fertilizer','variance')::numeric, 3000::numeric, 'fertilizer variance = planned − actual = 3000 (under budget)');
select is(pg_temp.bva_field('BVA-fertilizer','over_budget')::boolean, false, 'fertilizer is not over budget');
select is(pg_temp.bva_field('BVA-fuel','planned')::numeric, 5000::numeric, 'fuel planned = 5000');
select is(pg_temp.bva_field('BVA-fuel','actual')::numeric, 6000::numeric, 'fuel actual = 6000 (over)');
select is(pg_temp.bva_field('BVA-fuel','variance')::numeric, (-1000)::numeric, 'fuel variance = -1000 (over budget)');
select is(pg_temp.bva_field('BVA-fuel','over_budget')::boolean, true, 'fuel IS over budget');
select is(pg_temp.bva_field('BVA-water','planned')::numeric, 0::numeric, 'water has no budget line → planned 0');
select is(pg_temp.bva_field('BVA-water','actual')::numeric, 2000::numeric, 'water actual = 2000');
select is(pg_temp.bva_field('BVA-water','unbudgeted')::boolean, true, 'water spend is flagged unbudgeted (surfaced, not hidden)');

-- ── posted-only: reversing the fuel entry drops it from actuals ──────────────────────────────────────────────
update public.journal_entries set status = 'reversed' where id = current_setting('test.jw_fuel')::uuid;
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bva', public.fn_budget_vs_actual(current_setting('test.org')::uuid, '2026-03-01'::date, '2026-03-31'::date)::text, false);
reset role;
select is(pg_temp.bva_field('BVA-fuel','actual')::numeric, 0::numeric, 'reversed fuel entry excluded: fuel actual = 0');
select is(pg_temp.bva_field('BVA-fuel','over_budget')::boolean, false, 'fuel no longer over budget after reversal');

select finish();
rollback;
