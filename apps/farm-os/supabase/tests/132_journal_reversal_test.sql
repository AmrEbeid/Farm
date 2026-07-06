-- 132 - D3: journal reversal RPC and source-sequence re-posting.
-- Proves: anon lockdown, owner/accountant gate via budget.write, reason required, reversal pair creation,
-- reversal-of-reversal blocked, already-reversed no-op, reports stay honest, and re-posting the same
-- business source after reversal creates the next source_sequence as the active posted entry.

begin;
select plan(21);

\set org '00000000-0000-0000-0000-000000000001'
\set source 'c1320000-0000-0000-0000-000000000001'
\set lockedSource 'c1320000-0000-0000-0000-000000000002'

select set_config('test.org', :'org', false);
select set_config('test.source', :'source', false);
select set_config('test.locked_source', :'lockedSource', false);
select set_config('test.asset',   (select id::text from public.accounts where org_id=:'org' and code='1000'), false);
select set_config('test.expense', (select id::text from public.accounts where org_id=:'org' and code='5000'), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select ok(not has_function_privilege('anon', 'public.fn_reverse_journal_entry(uuid, text, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_reverse_journal_entry');
select ok(has_function_privilege('authenticated', 'public.fn_reverse_journal_entry(uuid, text, date)', 'EXECUTE'),
  'authenticated retains EXECUTE on fn_reverse_journal_entry');

select lives_ok(format($$ select set_config('test.entry', public.fn_post_two_line_journal(%L,'2026-04-01'::date,'jr_exp',%L,'مصروف خاطئ',%L,%L,2500)::text, false) $$,
    current_setting('test.org'), current_setting('test.source'), current_setting('test.expense'), current_setting('test.asset')),
  'post original journal entry for reversal');
select is((select source_sequence from public.journal_entries where id = current_setting('test.entry')::uuid), 1,
  'original entry uses source_sequence 1');
select is(
  public.fn_post_two_line_journal(current_setting('test.org')::uuid, '2026-04-01'::date, 'jr_exp', current_setting('test.source')::uuid, 'مصروف خاطئ', current_setting('test.expense')::uuid, current_setting('test.asset')::uuid, 2500),
  current_setting('test.entry')::uuid,
  'idempotent re-post while posted returns the same entry');

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_reverse_journal_entry(%L, 'تصحيح', '2026-04-02'::date) $$, current_setting('test.entry')),
  '42501', null, 'supervisor cannot reverse a journal entry');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$ select public.fn_reverse_journal_entry(%L, '   ', '2026-04-02'::date) $$, current_setting('test.entry')),
  '23502', null, 'reversal reason is required');
select lives_ok(format($$ select set_config('test.reversal', public.fn_reverse_journal_entry(%L, 'تصحيح قيد خاطئ', '2026-04-02'::date)::text, false) $$,
    current_setting('test.entry')),
  'accountant reverses the journal entry');
reset role;

select is((select status from public.journal_entries where id = current_setting('test.entry')::uuid), 'reversed',
  'original entry is marked reversed');
select is(
  (select jsonb_build_object('status', status, 'reversal_of', reversal_of, 'source_sequence', source_sequence)
     from public.journal_entries where id = current_setting('test.reversal')::uuid),
  jsonb_build_object('status', 'reversed', 'reversal_of', current_setting('test.entry')::uuid, 'source_sequence', 2),
  'reversal entry is linked and consumes source_sequence 2');
select is(
  (select credit from public.journal_lines
    where journal_entry_id = current_setting('test.reversal')::uuid
      and account_id = current_setting('test.expense')::uuid),
  2500::numeric,
  'reversal mirror swaps the original expense debit into a credit');

select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (select (row->>'net')::numeric
     from jsonb_array_elements(public.fn_accounting_trial_balance(current_setting('test.org')::uuid)) row
    where row->>'code' = '5000'),
  0::numeric,
  'trial balance all-lines view nets the original and reversal pair to zero');
select is(
  (public.fn_accounting_income_statement(current_setting('test.org')::uuid, '2026-04-01'::date, '2026-04-30'::date) ->> 'expenses_total')::numeric,
  0::numeric,
  'posted-only income statement excludes the reversed pair');

select throws_ok(format($$ select public.fn_reverse_journal_entry(%L, 'محاولة خاطئة', '2026-04-03'::date) $$, current_setting('test.reversal')),
  '22023', null, 'a reversal entry cannot itself be reversed');
select is(
  public.fn_reverse_journal_entry(current_setting('test.entry')::uuid, 'إعادة محاولة', '2026-04-03'::date),
  current_setting('test.reversal')::uuid,
  'reversing an already-reversed original is an idempotent no-op returning the reversal entry');
reset role;

select lives_ok(format($$ select set_config('test.repost', public.fn_post_two_line_journal(%L,'2026-04-04'::date,'jr_exp',%L,'مصروف مصحح',%L,%L,900)::text, false) $$,
    current_setting('test.org'), current_setting('test.source'), current_setting('test.expense'), current_setting('test.asset')),
  're-posting the same source after reversal creates a new active journal entry');
select is(
  (select jsonb_build_object('status', status, 'source_sequence', source_sequence)
     from public.journal_entries where id = current_setting('test.repost')::uuid),
  jsonb_build_object('status', 'posted', 'source_sequence', 3),
  'corrected re-post is posted with source_sequence 3');
select is(
  public.fn_post_two_line_journal(current_setting('test.org')::uuid, '2026-04-04'::date, 'jr_exp', current_setting('test.source')::uuid, 'مصروف مصحح', current_setting('test.expense')::uuid, current_setting('test.asset')::uuid, 900),
  current_setting('test.repost')::uuid,
  'repeat after corrected re-post returns the posted sequence 3 entry');

select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (public.fn_accounting_income_statement(current_setting('test.org')::uuid, '2026-04-01'::date, '2026-04-30'::date) ->> 'expenses_total')::numeric,
  900::numeric,
  'income statement includes only the corrected posted re-entry');
select is(
  (select (row->>'net')::numeric
     from jsonb_array_elements(public.fn_accounting_trial_balance(current_setting('test.org')::uuid)) row
    where row->>'code' = '5000'),
  900::numeric,
  'trial balance nets reversed pair plus corrected posted entry to 900');
reset role;

select set_config('test.locked_entry',
  public.fn_post_two_line_journal(current_setting('test.org')::uuid, '2026-05-10'::date, 'jr_locked', current_setting('test.locked_source')::uuid, 'داخل فترة مقفلة', current_setting('test.expense')::uuid, current_setting('test.asset')::uuid, 100)::text,
  false);
select pg_temp.as_user(current_setting('test.accountant'));
select public.fn_close_accounting_period(current_setting('test.org')::uuid, '2026-05-01'::date, '2026-05-31'::date, 'مايو 2026');
select throws_ok(format($$ select public.fn_reverse_journal_entry(%L, 'تصحيح بعد القفل', '2026-06-01'::date) $$, current_setting('test.locked_entry')),
  '55000', null, 'reversal refuses to mutate an entry whose original period is locked');
reset role;

select * from finish();
rollback;
