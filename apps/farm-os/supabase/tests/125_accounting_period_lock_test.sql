-- 125 — accounting period close/lock (SPEC-0004 §7.3 / ROADMAP Slice A item 3, migration 20260701550000).
-- Proves: close is owner/accountant, reopen (unlock) is owner-only, and a locked period rejects any NEW journal
-- posting via the single choke point fn_post_two_line_journal (which every posting path funnels through), while
-- open periods and reopened periods post normally. The lock helper is internal + org-scoped (cross-org isolation).
begin;
select plan(18);

\set org '00000000-0000-0000-0000-000000000001'
\set otherOrg '00000000-0000-0000-0000-0000000000ff'

-- two accounts in the seed org for the two-line journal (any two org accounts; the RPC only checks org ownership)
select set_config('test.org', :'org', false);
select set_config('test.dr', (select id::text from public.accounts where org_id = :'org' and code = '5110'), false);
select set_config('test.cr', (select id::text from public.accounts where org_id = :'org' and code = '5440'), false);
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner'      limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ── privilege surface ────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon','public.fn_period_locked(uuid, date)','EXECUTE'),
  'anon cannot EXECUTE fn_period_locked (internal)');
select ok(not has_function_privilege('authenticated','public.fn_period_locked(uuid, date)','EXECUTE'),
  'authenticated cannot EXECUTE fn_period_locked (internal)');
select ok(not has_function_privilege('anon','public.fn_close_accounting_period(uuid, date, date, text)','EXECUTE'),
  'anon cannot EXECUTE fn_close_accounting_period');
select ok(not has_function_privilege('anon','public.fn_reopen_accounting_period(uuid, uuid)','EXECUTE'),
  'anon cannot EXECUTE fn_reopen_accounting_period');
select ok(not has_table_privilege('authenticated','public.accounting_periods','INSERT'),
  'authenticated has no direct INSERT on accounting_periods (writes go through the RPC)');

-- ── close is gated (supervisor denied, accountant allowed) ────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_close_accounting_period(%L,'2026-01-01'::date,'2026-01-31'::date,'يناير 2026') $$, current_setting('test.org')),
  '42501', null, 'a supervisor (non-finance) cannot close a period');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select set_config('test.period', public.fn_close_accounting_period(%L,'2026-01-01'::date,'2026-01-31'::date,'يناير 2026')::text, false) $$, current_setting('test.org')),
  'an accountant closes January 2026');
reset role;

-- ── the lock helper sees the closed range, org-scoped ─────────────────────────────────────────────────────────
select is(public.fn_period_locked(current_setting('test.org')::uuid, '2026-01-15'::date), true,
  'fn_period_locked is TRUE for a date inside the closed period');
select is(public.fn_period_locked(current_setting('test.org')::uuid, '2026-02-15'::date), false,
  'fn_period_locked is FALSE for a date outside the closed period');
select is(public.fn_period_locked(:'otherOrg'::uuid, '2026-01-15'::date), false,
  'fn_period_locked is FALSE for another org (cross-org isolation)');

-- ── the guard rejects a NEW posting into the closed period, allows an open date ───────────────────────────────
select throws_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-01-15'::date,'period_lock_in',gen_random_uuid(),'ق',%L,%L,100) $$,
    current_setting('test.org'), current_setting('test.dr'), current_setting('test.cr')),
  '55000', null, 'posting into a locked period is rejected (55000)');
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-02-15'::date,'period_lock_open',gen_random_uuid(),'ق',%L,%L,100) $$,
    current_setting('test.org'), current_setting('test.dr'), current_setting('test.cr')),
  'posting into an open period succeeds');

-- ── overlapping close is rejected ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$ select public.fn_close_accounting_period(%L,'2026-01-20'::date,'2026-02-10'::date,'تداخل') $$, current_setting('test.org')),
  '23505', null, 'closing a period overlapping an existing locked period is rejected');
reset role;

-- ── reopen is owner-only ──────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_reopen_accounting_period(%L, %L) $$, current_setting('test.org'), current_setting('test.period')),
  '42501', null, 'a supervisor cannot reopen a period');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$ select public.fn_reopen_accounting_period(%L, %L) $$, current_setting('test.org'), current_setting('test.period')),
  '42501', null, 'an accountant cannot reopen a period (owner-only)');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$ select public.fn_reopen_accounting_period(%L, %L) $$, current_setting('test.org'), current_setting('test.period')),
  'the owner reopens the period');
reset role;

-- ── after reopen, the date is postable again ─────────────────────────────────────────────────────────────────
select is(public.fn_period_locked(current_setting('test.org')::uuid, '2026-01-15'::date), false,
  'fn_period_locked is FALSE after the owner reopens the period');
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-01-15'::date,'period_lock_reopened',gen_random_uuid(),'ق',%L,%L,100) $$,
    current_setting('test.org'), current_setting('test.dr'), current_setting('test.cr')),
  'posting into the reopened period succeeds');

select finish();
rollback;
