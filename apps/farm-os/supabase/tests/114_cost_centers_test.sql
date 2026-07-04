-- 114 — SPEC-0024 S-3: مراكز التكلفة (cost centers). Verifies migration 20260701450000: the budget.write
-- gate, cycle + depth guards, sector org-consistency, the per-org system «غير موزَّع» center (rename-only),
-- archive-vs-delete (subtree soft-delete), merge repointing (expenses + journal_lines), the expense
-- cost_center leaf/org guard, and anon lockdown. budget.write = owner/accountant (migration 0001).
--
-- Local shim runs as superuser (bypasses RLS/FORCE RLS); authorize() is exercised via jwt impersonation
-- (tests 44/82/85). Fixtures that must bypass the RPC gate are inserted directly as superuser.

begin;
select plan(29);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB '00000000-0000-0000-0000-0000000000cc'
\set farmB '00000000-0000-0000-0000-0000000000fc'
\set sectorB '00000000-0000-0000-0000-0000000000ac'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.owner'), '', 'fixture: an owner exists in orgA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) system «غير موزَّع» center — seeded by the org trigger / migration backfill in real orgs; the demo
-- seed runs under session_replication_role=replica (triggers off), so seed it explicitly here (this also
-- verifies fn_seed_cost_center_defaults is idempotent — safe to call again).
select public.fn_seed_cost_center_defaults(:'org');
select public.fn_seed_cost_center_defaults(:'org');
select is(
  (select count(*)::int from public.cost_centers where org_id = :'org' and code = 'CC-UNALLOC' and is_system),
  1, 'the per-org system «غير موزَّع» center is seeded (idempotently) and is_system');
select set_config('test.sys', (select id::text from public.cost_centers where org_id = :'org' and code = 'CC-UNALLOC'), false);
select is(
  (select count(*)::int from public.cost_centers where org_id = :'org' and code <> 'CC-UNALLOC'),
  18, 'the canonical Ebeid org receives the 18 real workbook cost centers');
select is(
  (select sector_id from public.cost_centers where org_id = :'org' and code = 'CC-HSW'),
  (select id from public.sectors where org_id = :'org' and code = 'HSW'),
  'seeded land center links to the matching physical sector when it exists');
select is(
  (select area_feddan from public.cost_centers where org_id = :'org' and code = 'CC-S22-PALM'),
  14::numeric, 'seeded enterprise center preserves the workbook area');
select ok(
  exists (
    select 1 from public.v_cost_center_reconciliation_flags
     where org_id = :'org'
       and code = 'CC-KMT'
       and flag_code = 'missing_sector_link'),
  'accounting-only centers are flagged instead of silently linked to a physical sector');

-- 2) create + gate
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.land',
    (public.fn_save_cost_center(null, %L, null, 'CC-TLAND', 'أرض اختبار', null, 'عام', 30, 1, true))->>'id', false) $$, :'org'),
  'owner creates a land (top-level) cost center');
select lives_ok(
  $$ select set_config('test.ent',
    (public.fn_save_cost_center(null, null, current_setting('test.land')::uuid, 'CC-TENT', 'نشاط اختبار', null, 'نخيل', 14, 1, true))->>'id', false) $$,
  'owner creates an enterprise sub-center under the land');
reset role;

select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_save_cost_center(null, %L, null, 'CC-X', 'مزيف', null, null, null, null, true) $$, :'org'),
  '42501', null, 'storekeeper (no budget.write) cannot create a cost center');
reset role;

-- 3) sector org-consistency
insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى') on conflict (id) do nothing;
insert into public.farms (id, org_id, name, code) values (:'farmB', :'orgB', 'مزرعة ب', 'FB') on conflict (id) do nothing;
insert into public.sectors (id, org_id, farm_id, name, code) values (:'sectorB', :'orgB', :'farmB', 'قطاع أجنبي', 'SXX')
  on conflict (id) do nothing;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ select public.fn_save_cost_center(null, %L, null, 'CC-CROSS', 'مركز', %L, null, null, null, true) $$, :'org', :'sectorB'),
  '42501', null, 'linking a cost center to a cross-org sector is rejected');

-- 4) cycle + depth cap
select throws_ok(
  $$ select public.fn_save_cost_center(current_setting('test.land')::uuid, null, current_setting('test.ent')::uuid, 'CC-TLAND', 'أرض اختبار', null, null, null, null, true) $$,
  '22023', null, 're-parenting a land under its own descendant is rejected (cycle)');
select set_config('test.d2', (public.fn_save_cost_center(null, null, current_setting('test.ent')::uuid, 'CC-D2', 'د2', null, null, null, null, true))->>'id', false);
select set_config('test.d3', (public.fn_save_cost_center(null, null, current_setting('test.d2')::uuid, 'CC-D3', 'د3', null, null, null, null, true))->>'id', false);
select throws_ok(
  $$ select public.fn_save_cost_center(null, null, current_setting('test.d3')::uuid, 'CC-D4', 'د4', null, null, null, null, true) $$,
  '22023', null, 'depth beyond 4 levels is rejected');
reset role;

-- 5) system center rename-only
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_save_cost_center(current_setting('test.sys')::uuid, null, null, 'CC-UNALLOC', 'غير موزَّع (محدث)', null, null, null, 1, true) $$,
  'system center can be renamed');
select throws_ok(
  $$ select public.fn_save_cost_center(current_setting('test.sys')::uuid, null, current_setting('test.land')::uuid, 'CC-UNALLOC', 'غير موزَّع', null, null, null, 1, true) $$,
  '22023', null, 'system center cannot be re-parented');
select throws_ok(
  $$ select public.fn_archive_cost_center(current_setting('test.sys')::uuid) $$,
  '22023', null, 'system center cannot be archived');
reset role;

-- 6) archive subtree
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_archive_cost_center(current_setting('test.d2')::uuid) $$,
  'archiving a center archives its subtree');
reset role;
select is(
  (select active from public.cost_centers where id = current_setting('test.d3')::uuid),
  false, 'the child (d3) was archived with its parent (soft-delete, row preserved)');

-- 7) merge repoints expenses + journal_lines
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.msrc', (public.fn_save_cost_center(null, :'org', null, 'CC-MSRC', 'دمج مصدر', null, null, null, null, true))->>'id', false);
select set_config('test.mdst', (public.fn_save_cost_center(null, :'org', null, 'CC-MDST', 'دمج هدف', null, null, null, null, true))->>'id', false);
reset role;
insert into public.expenses(org_id, category, total, kind, cost_center_id)
  values (:'org', 'اختبار', 300, 'operating', current_setting('test.msrc')::uuid)
  returning set_config('test.mexp', id::text, false);
insert into public.accounts(org_id, code, name_ar, account_type, normal_balance)
  values (:'org', '5-cc', 'مصروف اختبار', 'expense', 'debit')
  returning set_config('test.acct', id::text, false);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, description)
  values (:'org', current_date, 'test_cc_merge', gen_random_uuid(), 'اختبار دمج')
  returning set_config('test.je', id::text, false);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, cost_center_id)
  values (:'org', current_setting('test.je')::uuid, current_setting('test.acct')::uuid, 300, 0, current_setting('test.msrc')::uuid);

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_merge_cost_centers(current_setting('test.msrc')::uuid, current_setting('test.mdst')::uuid) $$,
  'owner merges two leaf cost centers');
reset role;
select is(
  (select cost_center_id from public.expenses where id = current_setting('test.mexp')::uuid),
  current_setting('test.mdst')::uuid, 'merge repointed the expense cost_center_id to the target');
select is(
  (select cost_center_id from public.journal_lines where journal_entry_id = current_setting('test.je')::uuid limit 1),
  current_setting('test.mdst')::uuid, 'merge repointed the journal line cost_center_id to the target');
select is(
  (select active from public.cost_centers where id = current_setting('test.msrc')::uuid),
  false, 'merge archived the source cost center');

-- 8) expense_cost_center_guard (leaf + org). The land now has an active enterprise child → non-leaf.
insert into public.expenses(org_id, category, total, kind) values (:'org', 'اختبار', 50, 'operating')
  returning set_config('test.gexp', id::text, false);
select throws_ok(
  format($$ update public.expenses set cost_center_id = %L where id = %L $$, current_setting('test.land'), current_setting('test.gexp')),
  '22023', null, 'an expense cannot point at a non-leaf cost center');
select lives_ok(
  format($$ update public.expenses set cost_center_id = %L where id = %L $$, current_setting('test.ent'), current_setting('test.gexp')),
  'an expense CAN point at an active leaf cost center');

-- 9) posting pass-through + rollup math. The debit expense line carries the center; the cash line does not.
insert into public.expenses(org_id, category, total, kind, cost_center_id)
  values (:'org', 'اختبار ترحيل', 140, 'operating', current_setting('test.ent')::uuid)
  returning set_config('test.pexp', id::text, false);
select lives_ok(
  format($$ select set_config('test.pje', public.fn_post_two_line_journal(
      %L::uuid,
      current_date,
      'test_cc_post',
      current_setting('test.pexp')::uuid,
      'اختبار مركز تكلفة',
      current_setting('test.acct')::uuid,
      public.fn_ensure_account(%L::uuid, '1000-test-cc', 'عهدة اختبار', 'asset', 'debit'),
      140,
      'مصروف اختبار',
      'نقدية اختبار',
      null,
      null,
      current_setting('test.pexp')::uuid,
      null)::text, false) $$, :'org', :'org'),
  'posting an expense writes a two-line journal');
select is(
  (select count(*)::int from public.journal_lines
    where journal_entry_id = current_setting('test.pje')::uuid
      and debit > 0
      and cost_center_id = current_setting('test.ent')::uuid),
  1, 'expense-side journal line carries the expense cost_center_id');
select ok(
  (select cost_center_id is null from public.journal_lines
    where journal_entry_id = current_setting('test.pje')::uuid and credit > 0),
  'cash-side journal line stays unallocated');
select is(
  (select net_per_feddan from public.v_cost_center_rollup where cost_center_id = current_setting('test.ent')::uuid),
  10::numeric, 'cost-center rollup computes net per feddan from expense/revenue lines');
insert into public.journal_entries(org_id, entry_date, source_type, source_id, description)
  values (:'org', current_date, 'test_cc_unalloc', gen_random_uuid(), 'اختبار غير موزع')
  returning set_config('test.uje', id::text, false);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, cost_center_id)
  values (:'org', current_setting('test.uje')::uuid, current_setting('test.acct')::uuid, 77, 0, null);
select is(
  (select net from public.v_cost_center_rollup where org_id = :'org' and code = 'CC-UNALLOC'),
  77::numeric, 'NULL expense/revenue center lines roll into «غير موزَّع»');

-- 10) anon lockdown
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_save_cost_center','fn_archive_cost_center','fn_merge_cost_centers','expense_cost_center_guard','fn_seed_cost_center_defaults')
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'none of the new cost-center functions are EXECUTE-able by anon');

select * from finish();
rollback;
