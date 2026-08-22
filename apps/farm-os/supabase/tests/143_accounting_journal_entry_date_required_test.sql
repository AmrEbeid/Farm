-- 143 — #719 item 3: the journal choke point rejects NULL dates instead of silently posting today.

begin;
select plan(7);

\set org '00000000-0000-0000-0000-000000000001'
\set null_source 'aaaa0719-0003-0000-0000-000000000001'
\set dated_source 'aaaa0719-0003-0000-0000-000000000002'

select set_config('test.debit', (
  select id::text from public.accounts where org_id = :'org' and code = '1000' limit 1
), false);
select set_config('test.credit', (
  select id::text from public.accounts where org_id = :'org' and code = '3000' limit 1
), false);

select has_function(
  'public',
  'fn_post_two_line_journal',
  array['uuid','date','text','uuid','text','uuid','uuid','numeric','text','text','uuid','uuid','uuid','uuid'],
  '#719-3: the journal helper signature is unchanged');

select throws_ok(
  format(
    $$select public.fn_post_two_line_journal(%L, null, 'null_date_test', %L, 'قيد بلا تاريخ', %L, %L, 100)$$,
    :'org', :'null_source', current_setting('test.debit'), current_setting('test.credit')
  ),
  '23502',
  'entry_date required',
  '#719-3: a NULL accounting entry date is rejected explicitly');

select is(
  (select count(*)::int from public.journal_entries
    where org_id = :'org' and source_type = 'null_date_test' and source_id = :'null_source'),
  0,
  '#719-3: rejecting a NULL date writes no journal entry');

select lives_ok(
  format(
    $$select set_config('test.dated_entry', public.fn_post_two_line_journal(%L, '2026-10-15'::date, 'explicit_date_test', %L, 'قيد مؤرخ', %L, %L, 100)::text, false)$$,
    :'org', :'dated_source', current_setting('test.debit'), current_setting('test.credit')
  ),
  '#719-3: an explicit date still posts successfully');

select is(
  (select entry_date from public.journal_entries
    where org_id = :'org' and source_type = 'explicit_date_test' and source_id = :'dated_source'),
  date '2026-10-15',
  '#719-3: the explicit accounting date is preserved exactly');

insert into public.accounting_periods(org_id, period_start, period_end, status, note)
values (:'org', date '2026-10-01', date '2026-10-31', 'locked', 'اختبار أكتوبر');

select is(
  public.fn_post_two_line_journal(
    :'org', date '2026-10-15', 'explicit_date_test', :'dated_source', 'إعادة إرسال',
    current_setting('test.debit')::uuid, current_setting('test.credit')::uuid, 100
  ),
  current_setting('test.dated_entry')::uuid,
  '#719-3: a valid-date retry remains idempotent before the period-lock check');

select ok(
  not has_function_privilege(
    'authenticated',
    'public.fn_post_two_line_journal(uuid,date,text,uuid,text,uuid,uuid,numeric,text,text,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  '#719-3: authenticated clients still cannot execute the internal helper');

select finish();
rollback;
