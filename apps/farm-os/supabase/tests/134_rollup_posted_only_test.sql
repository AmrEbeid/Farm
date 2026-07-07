-- 134 — v_cost_center_rollup must exclude REVERSED journal entries (migration 20260707120000, issue #863).
-- Define-check-first pin: a posted, cost-center-tagged expense rolls up into the center's debit; once its entry
-- is reversed (status='reversed'), it must NO LONGER inflate the rollup — matching the posted-only statements.
-- FAILS against the old view (no status filter → the reversed debit still counts). Fixtures inserted as
-- superuser (RLS-bypassed); the seed carries almost no journal activity so the single entry is deterministic.
-- Run via test-shims/run-pgtap-local.sh.
begin;
select plan(3);

\set org '00000000-0000-0000-0000-000000000001'
\set acc 'c1340000-0000-0000-0000-0000000000a1'
\set cc  'c1340000-0000-0000-0000-0000000000c1'
\set je  'c1340000-0000-0000-0000-000000000001'

-- an expense account, a cost center, and one POSTED entry booking 500 of expense to that center.
insert into public.accounts (id, org_id, code, name_ar, account_type, normal_balance, active)
  values (:'acc', :'org', 'T934', 'مصروف اختبار التدوير', 'expense', 'debit', true);
insert into public.cost_centers (id, org_id, code, name_ar, is_system, active)
  values (:'cc', :'org', 'CC-T934', 'مركز اختبار التدوير', false, true);
insert into public.journal_entries (id, org_id, entry_date, source_type, source_id, description, status)
  values (:'je', :'org', current_date, 'test_rollup_posted', :'je', 'قيد مصروف مرحّل', 'posted');
insert into public.journal_lines (org_id, journal_entry_id, account_id, cost_center_id, debit, credit)
  values (:'org', :'je', :'acc', :'cc', 500, 0);

-- 1) a POSTED, cost-center-tagged expense shows in that center's rollup debit.
select is(
  (select debit from public.v_cost_center_rollup where cost_center_id = :'cc'),
  500::numeric, 'posted expense line rolls up into the cost-center debit');

-- 2) THE PIN: reverse the entry → it must drop out of the rollup (FAILS on the old, unfiltered view).
update public.journal_entries set status = 'reversed' where id = :'je';
select is(
  (select debit from public.v_cost_center_rollup where cost_center_id = :'cc'),
  0::numeric, 'a reversed entry no longer inflates the cost-center rollup debit');

-- 3) net is likewise clean (no orphaned credit/debit left behind for the center).
select is(
  (select net from public.v_cost_center_rollup where cost_center_id = :'cc'),
  0::numeric, 'a reversed entry leaves the center net at 0');

select * from finish();
