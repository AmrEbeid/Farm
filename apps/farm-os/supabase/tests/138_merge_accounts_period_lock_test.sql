-- 138 — #719 item 1: fn_merge_accounts must respect the period lock (migration 20260712110000). A merge whose
-- SOURCE account carries a posting in a LOCKED period is rejected (repointing it would rewrite that period's
-- per-account balances); a merge touching only OPEN periods succeeds and repoints/deactivates as before.
-- Mirrors 125's authorize + lock setup. Rows seeded as superuser (RLS bypassed); org + accountant from seed.

begin;
select plan(6);

\set org '00000000-0000-0000-0000-000000000001'
\set src  'aaaa0719-0001-0000-0000-000000000001'
\set tgt  'aaaa0719-0001-0000-0000-000000000002'
\set cr   'aaaa0719-0001-0000-0000-000000000003'
\set src2 'aaaa0719-0001-0000-0000-000000000004'
\set tgt2 'aaaa0719-0001-0000-0000-000000000005'

select set_config('test.org', :'org', false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner'      limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- dedicated leaf accounts (same type/kind so the merge's type/kind guard passes); cr is the credit side.
insert into public.accounts (id, org_id, code, name_ar, account_type, normal_balance, kind, active, is_system) values
  (:'src',  :'org', 'T900', 'مصدر مقفول', 'expense', 'debit',  'operating', true, false),
  (:'tgt',  :'org', 'T901', 'هدف مقفول',  'expense', 'debit',  'operating', true, false),
  (:'cr',   :'org', 'T902', 'دائن اختبار','revenue', 'credit', 'operating', true, false),
  (:'src2', :'org', 'T903', 'مصدر مفتوح', 'expense', 'debit',  'operating', true, false),
  (:'tgt2', :'org', 'T904', 'هدف مفتوح',  'expense', 'debit',  'operating', true, false);

-- ── locked case: post on src in July, then lock July ──────────────────────────────────────────────────
-- fn_post_two_line_journal is the internal choke point (no authenticated EXECUTE), so post as superuser
-- (mirrors test 125); the close is role-gated so it runs as the accountant.
reset role;
select public.fn_post_two_line_journal(current_setting('test.org')::uuid, '2026-07-15'::date, 'merge_lock_test',
  gen_random_uuid(), 'ق', :'src'::uuid, :'cr'::uuid, 100);

select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.july', public.fn_close_accounting_period(current_setting('test.org')::uuid, '2026-07-01'::date, '2026-07-31'::date, 'يوليو 2026')::text, false);
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ select public.fn_merge_accounts(%L, %L) $$, :'src', :'tgt'),
  '55000', null,
  '#719-1: merging a source with a posting in a LOCKED period is rejected (55000)');
reset role;

-- mixed: add an OPEN (September) posting to the same source — a single locked line must still reject
reset role;
select public.fn_post_two_line_journal(current_setting('test.org')::uuid, '2026-09-15'::date, 'merge_mixed_test',
  gen_random_uuid(), 'ق', :'src'::uuid, :'cr'::uuid, 100);

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ select public.fn_merge_accounts(%L, %L) $$, :'src', :'tgt'),
  '55000', null,
  '#719-1: a source with mixed open+locked postings is still rejected (any locked line blocks the merge)');
reset role;

-- ── open case: post on src2 in August (never locked); merge succeeds ──────────────────────────────────
reset role;
select public.fn_post_two_line_journal(current_setting('test.org')::uuid, '2026-08-15'::date, 'merge_open_test',
  gen_random_uuid(), 'ق', :'src2'::uuid, :'cr'::uuid, 100);

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select public.fn_merge_accounts(%L, %L) $$, :'src2', :'tgt2'),
  '#719-1: merging a source with only OPEN-period postings succeeds');
reset role;

-- the successful merge actually repointed the line and deactivated the source
select is(
  (select active from public.accounts where id = :'src2'),
  false, '#719-1: the merged-away source account is deactivated');
select is(
  (select count(*)::int from public.journal_lines where account_id = :'tgt2'),
  1, '#719-1: the source line was repointed to the target');

-- reopen the locked period (owner-only): the same source→target merge now succeeds
select pg_temp.as_user(current_setting('test.owner'));
select public.fn_reopen_accounting_period(current_setting('test.org')::uuid, current_setting('test.july')::uuid);
select lives_ok(
  format($$ select public.fn_merge_accounts(%L, %L) $$, :'src', :'tgt'),
  '#719-1: after the period is reopened, the previously-blocked merge succeeds');
reset role;

select finish();
rollback;
