-- Exact decimal inputs must survive custody account, owner-funding and transfer write paths.
begin;
select plan(11);

\set org '00000000-0000-0000-0000-000000000001'

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(
  (select user_id::text from public.organization_member where org_id = :'org' and role = 'accountant' limit 1)
);

select lives_ok(
  format(
    $$select set_config('test.exact_acct_from', public.fn_save_custody_account(null, %L, 'عهدة دقيقة أ', null, %L, true)::text, false)$$,
    :'org', '9007199254740993.123456789012345678'
  ),
  'custody account accepts an exact high-precision target string'
);
select is(
  (select target_float from public.custody_accounts where id = current_setting('test.exact_acct_from')::uuid),
  9007199254740993.123456789012345678::numeric,
  'custody target preserves every input digit'
);

select lives_ok(
  format(
    $$select set_config('test.exact_acct_to', public.fn_save_custody_account(null, %L, 'عهدة دقيقة ب', null, %L, true)::text, false)$$,
    :'org', '0'
  ),
  'second custody account accepts an exact zero target string'
);

select lives_ok(
  format(
    $$select set_config('test.exact_receipt', public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', %L, %L)::text, false)$$,
    current_setting('test.exact_acct_from'), '10.123456789012345678', '0'
  ),
  'owner-funding receipt accepts an exact high-precision string'
);
select is(
  (select amount_in from public.custody_movements where id = current_setting('test.exact_receipt')::uuid),
  10.123456789012345678::numeric,
  'owner-funding custody row preserves every input digit'
);
select is(
  (
    select max(greatest(debit, credit))
    from public.journal_lines
    where journal_entry_id = (
      select journal_entry_id from public.custody_movements where id = current_setting('test.exact_receipt')::uuid
    )
  ),
  10.123456789012345678::numeric,
  'owner-funding journal mirrors preserve every input digit'
);

select lives_ok(
  format(
    $$select set_config('test.exact_transfer', public.fn_transfer_custody(%L, %L, %L, current_date, 'تحويل دقيق')::text, false)$$,
    current_setting('test.exact_acct_from'), current_setting('test.exact_acct_to'),
    '0.123456789012345678'
  ),
  'custody transfer accepts an exact high-precision string'
);
select is(
  (
    select amount_out from public.custody_movements
    where transfer_group_id = current_setting('test.exact_transfer')::uuid and custody_account_id = current_setting('test.exact_acct_from')::uuid
  ),
  0.123456789012345678::numeric,
  'transfer cash-out preserves every input digit'
);
select is(
  (
    select amount_in from public.custody_movements
    where transfer_group_id = current_setting('test.exact_transfer')::uuid and custody_account_id = current_setting('test.exact_acct_to')::uuid
  ),
  0.123456789012345678::numeric,
  'transfer cash-in preserves every input digit'
);
select is(
  public.fn_custody_balance(current_setting('test.exact_acct_from')::uuid),
  10::numeric,
  'source balance subtracts the transfer exactly'
);
select is(
  public.fn_custody_balance(current_setting('test.exact_acct_to')::uuid),
  0.123456789012345678::numeric,
  'destination balance adds the transfer exactly'
);

reset role;
select * from finish();
rollback;
