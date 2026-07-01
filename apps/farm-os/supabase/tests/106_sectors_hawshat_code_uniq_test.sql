-- 106 — bulk-import idempotency backstop (migration 20260701150000): a partial UNIQUE index on
-- (org_id, code) for active sectors/hawshat, so a re-import can't silently double-insert (23505 instead).
-- Structural: both indexes exist and are UNIQUE + PARTIAL. Run via test-shims/run-pgtap-local.sh.

begin;
select plan(4);

select is(
  (select count(*)::int from pg_indexes
    where schemaname='public' and tablename='sectors' and indexname='sectors_org_code_active_uniq'),
  1, 'import: sectors_org_code_active_uniq exists');
select ok(
  (select indisunique and indpred is not null from pg_index i join pg_class c on c.oid=i.indexrelid
     where c.relname='sectors_org_code_active_uniq'),
  'import: sectors code index is a partial UNIQUE index');

select is(
  (select count(*)::int from pg_indexes
    where schemaname='public' and tablename='hawshat' and indexname='hawshat_org_code_active_uniq'),
  1, 'import: hawshat_org_code_active_uniq exists');
select ok(
  (select indisunique and indpred is not null from pg_index i join pg_class c on c.oid=i.indexrelid
     where c.relname='hawshat_org_code_active_uniq'),
  'import: hawshat code index is a partial UNIQUE index');

select * from finish();
rollback;
