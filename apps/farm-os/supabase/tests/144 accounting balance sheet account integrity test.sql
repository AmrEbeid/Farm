-- 144 — #719 item 5: the balance sheet refuses entry, line, or account organization disagreement.

begin;
select plan(10);

\set org '00000000-0000-0000-0000-000000000001'
\set other_org 'b1440000-0000-0000-0000-000000000002'
\set other_account 'b1440000-0000-0000-0000-000000000003'
\set source_id 'b1440000-0000-0000-0000-000000000004'

select set_config('test.owner',
  (select user_id::text
     from public.organization_member
    where org_id = :'org' and role = 'owner'
    limit 1), false);
select set_config('test.asset',
  (select id::text from public.accounts where org_id = :'org' and code = '1000'), false);
select set_config('test.equity',
  (select id::text from public.accounts where org_id = :'org' and code = '3000'), false);

create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end $$;

select has_function(
  'public',
  'fn_accounting_balance_sheet',
  array['uuid', 'date'],
  '#719-5: balance-sheet signature is unchanged');

select is(
  (select prosecdef from pg_proc where oid = 'public.fn_accounting_balance_sheet(uuid,date)'::regprocedure),
  true,
  '#719-5: function remains SECURITY DEFINER');

select is(
  (select provolatile::text from pg_proc where oid = 'public.fn_accounting_balance_sheet(uuid,date)'::regprocedure),
  's',
  '#719-5: function remains STABLE');

select ok(
  (select proconfig @> array['search_path=""']
     from pg_proc
    where oid = 'public.fn_accounting_balance_sheet(uuid,date)'::regprocedure),
  '#719-5: function keeps an empty search_path');

select ok(
  not has_function_privilege('anon', 'public.fn_accounting_balance_sheet(uuid,date)', 'EXECUTE'),
  '#719-5: anon cannot execute the balance sheet');

select ok(
  has_function_privilege('authenticated', 'public.fn_accounting_balance_sheet(uuid,date)', 'EXECUTE'),
  '#719-5: authenticated keeps the gated execute grant');

select set_config(
  'test.entry',
  public.fn_post_two_line_journal(
    :'org',
    date '2026-11-01',
    'balance_sheet_integrity_test',
    :'source_id',
    'قيد سلامة الميزانية',
    current_setting('test.asset')::uuid,
    current_setting('test.equity')::uuid,
    100
  )::text,
  false
);

select pg_temp.as_owner();
select is(
  (public.fn_accounting_balance_sheet(:'org', date '2026-11-30')->>'balanced')::boolean,
  true,
  '#719-5: an ordinary same-org posted entry still returns a balanced statement');
reset role;

insert into public.organization(id, name)
values (:'other_org', 'مزرعة اختبار سلامة الميزانية');

insert into public.accounts(
  id, org_id, code, name_ar, account_type, normal_balance, active
)
values (
  :'other_account', :'other_org', 'B144', 'حساب من مزرعة أخرى', 'asset', 'debit', true
);

update public.journal_lines
   set account_id = :'other_account'
 where journal_entry_id = current_setting('test.entry')::uuid
   and debit > 0;

select pg_temp.as_owner();
select throws_ok(
  format(
    $$select public.fn_accounting_balance_sheet(%L, '2026-11-30'::date)$$,
    :'org'
  ),
  '23514',
  'balance sheet account integrity check failed',
  '#719-5: a posted cross-org account reference fails closed instead of disappearing');
reset role;

update public.journal_lines
   set account_id = current_setting('test.asset')::uuid,
       org_id = :'other_org'
 where journal_entry_id = current_setting('test.entry')::uuid
   and debit > 0;

update public.journal_lines
   set org_id = :'other_org'
 where journal_entry_id = current_setting('test.entry')::uuid
   and credit > 0;

select pg_temp.as_owner();
select throws_ok(
  format(
    $$select public.fn_accounting_balance_sheet(%L, '2026-11-30'::date)$$,
    :'org'
  ),
  '23514',
  'balance sheet account integrity check failed',
  '#719-5: moving every line away from its entry org fails closed instead of hiding the entry');
reset role;

update public.journal_entries
   set org_id = :'other_org'
 where id = current_setting('test.entry')::uuid;

update public.journal_lines
   set org_id = :'org'
 where journal_entry_id = current_setting('test.entry')::uuid;

select pg_temp.as_owner();
select throws_ok(
  format(
    $$select public.fn_accounting_balance_sheet(%L, '2026-11-30'::date)$$,
    :'org'
  ),
  '23514',
  'balance sheet account integrity check failed',
  '#719-5: lines retained by an org but attached to another org entry fail closed');
reset role;

select finish();
rollback;
