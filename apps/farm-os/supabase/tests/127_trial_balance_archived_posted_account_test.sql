-- 127 — fn_accounting_trial_balance must NOT drop an archived account that still carries postings
-- (migration 20260705120000). Define-check-first pin for the money-correctness bug: fn_archive_account
-- deactivates a posted account with no postings check, and the trial balance filtered `a.active`, so the
-- archived account's lines vanished → Σdebit ≠ Σcredit (statement stops footing) and the /accounting KPIs
-- understate. The seed carries NO journal activity, so the single balanced entry below is the only ledger
-- data → the "foots" assertions are fully deterministic. Impersonation via request.jwt.claims (tests 112/108).
-- Run via test-shims/run-pgtap-local.sh.
begin;
select plan(5);

\set org '00000000-0000-0000-0000-000000000001'
\set ta 'c1270000-0000-0000-0000-0000000000a1'
\set te 'c1270000-0000-0000-0000-0000000000e1'
\set tz 'c1270000-0000-0000-0000-0000000000f1'
\set je 'c1270000-0000-0000-0000-000000000001'

-- fixtures (superuser, RLS-bypassed): two posted leaf accounts (an asset + its balancing equity) and one
-- ARCHIVED account with no postings (to prove no-clutter is preserved), plus one BALANCED journal entry.
insert into public.accounts (id, org_id, code, name_ar, account_type, normal_balance, active)
  values (:'ta', :'org', 'T900', 'أصل اختبار مرحّل', 'asset',  'debit',  true),
         (:'te', :'org', 'T910', 'حقوق اختبار مرحّلة', 'equity', 'credit', true),
         (:'tz', :'org', 'T920', 'حساب مؤرشف بلا حركة', 'asset',  'debit',  false);
insert into public.journal_entries (id, org_id, entry_date, source_type, source_id, description, status)
  values (:'je', :'org', current_date, 'test_tb_archive', :'je', 'قيد اختبار متوازن', 'posted');
insert into public.journal_lines (org_id, journal_entry_id, account_id, debit, credit)
  values (:'org', :'je', :'ta', 1000, 0),
         (:'org', :'je', :'te', 0, 1000);

select set_config('test.owner',
  (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1), false);
create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) baseline (TA active): TA shows its debit, and the trial balance foots.
select pg_temp.as_owner();
select is(
  (select (row->>'debit')::numeric from jsonb_array_elements(public.fn_accounting_trial_balance(:'org')) row
     where row->>'code' = 'T900'),
  1000::numeric, 'baseline: active posted account T900 shows debit 1000');
select is(
  (select sum((row->>'debit')::numeric) - sum((row->>'credit')::numeric)
     from jsonb_array_elements(public.fn_accounting_trial_balance(:'org')) row),
  0::numeric, 'baseline: trial balance foots (Σdebit = Σcredit)');
reset role;

-- Archive the POSTED account (fn_archive_account blocks only system accounts — this is reachable).
update public.accounts set active = false where id = :'ta';

-- 2) THE PIN: an archived-but-posted account must still appear with its balance, and the statement must
--    still foot. FAILS on the old `and a.active` filter (TA's debit vanishes → Σdebit=0 ≠ Σcredit=1000).
select pg_temp.as_owner();
select is(
  (select (row->>'debit')::numeric from jsonb_array_elements(public.fn_accounting_trial_balance(:'org')) row
     where row->>'code' = 'T900'),
  1000::numeric, 'archived posted account T900 still appears with its debit (not dropped)');
select is(
  (select sum((row->>'debit')::numeric) - sum((row->>'credit')::numeric)
     from jsonb_array_elements(public.fn_accounting_trial_balance(:'org')) row),
  0::numeric, 'trial balance STILL foots after archiving a posted account');
-- 3) an archived account with NO postings stays excluded (the fix adds no clutter).
select ok(
  not exists (select 1 from jsonb_array_elements(public.fn_accounting_trial_balance(:'org')) row
                where row->>'code' = 'T920'),
  'archived account with no postings stays excluded (no clutter)');
reset role;

select * from finish();
