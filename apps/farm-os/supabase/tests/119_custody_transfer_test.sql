-- 119 — SPEC-0018-EXT slice 1: atomic custody holder transfer.
-- Verifies farm-manager/accountant custody handover as one linked out/in pair, with no journal/P&L effect.
begin;
select plan(16);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB 'c1190000-0000-0000-0000-00000000000b'
\set fromAcct 'c1190000-0000-0000-0000-0000000000f0'
\set toAcct 'c1190000-0000-0000-0000-0000000000a0'
\set otherAcct 'c1190000-0000-0000-0000-0000000000b0'

insert into public.organization (id, name) values (:'orgB', 'مزرعة اختبار تحويل العهدة');
insert into public.custody_accounts (id, org_id, holder_label, target_float)
  values
    (:'fromAcct', :'org', 'مدير المزرعة', 30000),
    (:'toAcct', :'org', 'المحاسب', 0),
    (:'otherAcct', :'orgB', 'محاسب مزرعة أخرى', 0);

select set_config('test.from_acct', :'fromAcct', false);
select set_config('test.to_acct', :'toAcct', false);
select set_config('test.other_acct', :'otherAcct', false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where org_id = :'org' and role = 'farm_manager' limit 1), false);

select ok(not has_function_privilege('anon', 'public.fn_transfer_custody(uuid, uuid, numeric, date, text)', 'EXECUTE'),
  'anon cannot EXECUTE fn_transfer_custody');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format($$ select public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', 30000, 0) $$, current_setting('test.from_acct')),
  'accountant records the farm-manager standing custody float');
select set_config('test.before_journals', (select count(*)::text from public.journal_entries), false);
select lives_ok(
  format($$ select set_config('test.transfer_group', public.fn_transfer_custody(%L, %L, 12000, current_date, 'تسليم للمحاسب')::text, false) $$,
    current_setting('test.from_acct'), current_setting('test.to_acct')),
  'accountant transfers part of the farm-manager custody to the accountant');

select is(public.fn_custody_balance(:'fromAcct'), 18000::numeric,
  'source custody balance decreases by the transfer amount');
select is(public.fn_custody_balance(:'toAcct'), 12000::numeric,
  'destination custody balance increases by the transfer amount');
select is((select count(*)::int from public.custody_movements where transfer_group_id = current_setting('test.transfer_group')::uuid), 2,
  'transfer writes exactly two linked custody movement rows');
select is((select count(*)::int from public.custody_movements where transfer_group_id = current_setting('test.transfer_group')::uuid and amount_out = 12000), 1,
  'transfer group has one source out-movement');
select is((select count(*)::int from public.custody_movements where transfer_group_id = current_setting('test.transfer_group')::uuid and amount_in = 12000), 1,
  'transfer group has one destination in-movement');
select is(
  (select coalesce(sum(amount_in), 0) - coalesce(sum(amount_out), 0)
     from public.custody_movements
    where transfer_group_id = current_setting('test.transfer_group')::uuid),
  0::numeric,
  'transfer group conserves total custody cash');
select is((select count(*)::int from public.journal_entries), current_setting('test.before_journals')::int,
  'custody-to-custody transfer creates no journal entry');

select throws_ok(
  format($$ select public.fn_transfer_custody(%L, %L, 999999, current_date, null) $$,
    current_setting('test.from_acct'), current_setting('test.to_acct')),
  '22023', null, 'cannot transfer more than the source custody balance');
select throws_ok(
  format($$ select public.fn_transfer_custody(%L, %L, 1, current_date, null) $$,
    current_setting('test.from_acct'), current_setting('test.from_acct')),
  '22023', null, 'cannot transfer from an account to itself');
select throws_ok(
  format($$ select public.fn_transfer_custody(%L, %L, 1, current_date, null) $$,
    current_setting('test.from_acct'), current_setting('test.other_acct')),
  '42501', null, 'cannot transfer custody across orgs');
select throws_ok(
  format($$ select public.fn_transfer_custody(%L, %L, 0, current_date, null) $$,
    current_setting('test.from_acct'), current_setting('test.to_acct')),
  '22023', null, 'cannot transfer a zero amount');
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(
  format($$ select public.fn_transfer_custody(%L, %L, 1, current_date, null) $$,
    current_setting('test.from_acct'), current_setting('test.to_acct')),
  '42501', null, 'farm-manager cannot directly transfer custody without owner-ratified finance access');
reset role;

select is((select count(*)::int from public.custody_movements where transfer_group_id = current_setting('test.transfer_group')::uuid), 2,
  'failed transfer attempts do not add extra linked movement rows');

select * from finish();
rollback;
