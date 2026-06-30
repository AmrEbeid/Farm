-- 101 — #503: the storage-layer backstop "one cash-out per expense" exists (migration 20260701120000).
-- Structural: assert the partial unique index is present on custody_movements(expense_id) where amount_out>0.
-- (Enforcement itself is Postgres's unique-index guarantee; the runtime invariant is in
-- fn_set_expense_payment_status.)
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

select is(
  (select count(*)::int
     from pg_indexes
    where schemaname = 'public'
      and tablename = 'custody_movements'
      and indexname = 'custody_movements_one_out_per_expense_uniq'),
  1, '#503: the one-cash-out-per-expense unique index exists');

-- it must be UNIQUE and PARTIAL (carries a WHERE predicate), else it would not enforce the invariant
select ok(
  (select indisunique and indpred is not null
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'custody_movements_one_out_per_expense_uniq'),
  '#503: the index is a partial UNIQUE index (enforces at most one cash-out per expense)');

select * from finish();
rollback;
