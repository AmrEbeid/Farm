-- 133 — accounting-kernel correctness (migration 20260708100000):
--   F2 revenue posts on the sale's economic date (not current_date),
--   F1 a sale whose revenue entry was reversed can no longer be collected,
--   F3 the trial-balance debit/credit columns are posted-only (reversed lines excluded).

begin;
select plan(7);

\set org '00000000-0000-0000-0000-000000000001'

select set_config('test.org', :'org', false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.accountant'));

-- Baseline posted credit on 4000 before we post anything (robust to any pre-seeded revenue).
select set_config('test.rev0',
  coalesce((select (row->>'credit') from jsonb_array_elements(public.fn_accounting_trial_balance(current_setting('test.org')::uuid)) row
             where row->>'code' = '4000'), '0'),
  false);

-- Seed a pending sale dated well in the past (p_id NULL → insert), capturing the new id; then finalize (qty 100 × 10).
select lives_ok(
  format($$ select set_config('test.sale',
      (public.fn_save_sale(null, %L, '2025-03-15'::date, 'بلح للاختبار', null, null, null, null, null, null, 100, 'كجم') ->> 'id'),
      false) $$,
    current_setting('test.org')),
  'seed a pending sale dated 2025-03-15');
select lives_ok(
  format($$ select public.fn_finalize_sale_price(%L, 10) $$, current_setting('test.sale')),
  'finalize the sale price (posts revenue)');

-- F2 — the revenue journal entry is dated on the sale date, not today.
select is(
  (select entry_date from public.journal_entries
    where org_id = current_setting('test.org')::uuid and source_type = 'sale'
      and source_id = current_setting('test.sale')::uuid and status = 'posted'),
  '2025-03-15'::date,
  'F2: revenue posts on the sale date, not current_date');

-- F1 (happy path) — collection is allowed while a posted revenue entry exists.
select lives_ok(
  format($$ select public.fn_record_sale_collection(%L, 200, '2025-03-20'::date) $$, current_setting('test.sale')),
  'F1: collection allowed while the revenue entry is posted');

-- Reverse the sale's revenue entry.
select lives_ok(
  format($$ select public.fn_reverse_journal_entry(
      (select id from public.journal_entries where org_id = %L and source_type = 'sale'
         and source_id = %L and status = 'posted'),
      'إلغاء البيع', '2025-03-25'::date) $$,
    current_setting('test.org'), current_setting('test.sale')),
  'reverse the sale revenue entry');

-- F1 — after reversal there is no posted revenue entry, so further collection is refused.
select throws_ok(
  format($$ select public.fn_record_sale_collection(%L, 100, '2025-03-26'::date) $$, current_setting('test.sale')),
  '22023', null,
  'F1: collection refused after the revenue entry is reversed');

-- F3 — the trial-balance credit column on 4000 returns to baseline (the reversed finalize line is excluded).
select is(
  (select (row->>'credit')::numeric from jsonb_array_elements(public.fn_accounting_trial_balance(current_setting('test.org')::uuid)) row
    where row->>'code' = '4000'),
  current_setting('test.rev0')::numeric,
  'F3: trial-balance credit column is posted-only (reversed revenue excluded)');

reset role;
select * from finish();
rollback;
