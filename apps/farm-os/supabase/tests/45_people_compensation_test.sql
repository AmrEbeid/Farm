-- 45 — PII-1 (#173): wages live in role-gated people_compensation, NOT on the org-readable people
-- table. Before migration 0045, people.rate was readable by any org member; now wages are in
-- people_compensation (RLS: owner/accountant only, via authorize('budget.write')) and people.rate
-- is dropped. Confirms: the confidentiality gate (a field role cannot read or write compensation),
-- the legitimate path (owner can), and the column relocation. budget.write = owner/accountant (0001).
-- Impersonation via request.jwt.claims (tests 10/24/25/36/42/43/44).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(7);

-- structural: the leaking column is gone; the new table holds the wage.
select hasnt_column('public', 'people', 'rate',
  '#173: people.rate (the leaking wage column) has been dropped');
select has_column('public', 'people_compensation', 'rate',
  '#173: people_compensation carries the wage');

select set_config('test.person', (select id::text from public.people
  where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1), false);
select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'owner' limit 1), false);
select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'storekeeper' limit 1), false);

-- ===== owner (budget.write) — the legitimate payroll path works + seeds a row =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  format($$ insert into public.people_compensation (org_id, person_id, rate)
            values ('00000000-0000-0000-0000-000000000001', %L, 5000) $$, current_setting('test.person')),
  '#173: an owner (budget.write) CAN write a compensation row');

select is(
  (select count(*)::int from public.people_compensation
     where org_id = '00000000-0000-0000-0000-000000000001'),
  1,
  '#173: an owner CAN read compensation (sees the row)');

reset role;

-- ===== a field role (storekeeper, no budget.write) — confidentiality gate =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.people_compensation
     where org_id = '00000000-0000-0000-0000-000000000001'),
  0,
  '#173: a storekeeper CANNOT read compensation (RLS USING blocks — 0 rows, no wage leak)');

select throws_ok(
  format($$ insert into public.people_compensation (org_id, person_id, rate)
            values ('00000000-0000-0000-0000-000000000001', %L, 1) $$, current_setting('test.person')),
  '42501', null,
  '#173: a storekeeper CANNOT write compensation');

reset role;

-- ===== structural invariant: the gate is present =====
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'people_compensation'
       and qual like '%authorize%budget.write%'
       and with_check like '%authorize%budget.write%'),
  1,
  '#173: people_compensation policy gates BOTH read (USING) and write (WITH CHECK) on authorize(budget.write)');

select * from finish();
rollback;
