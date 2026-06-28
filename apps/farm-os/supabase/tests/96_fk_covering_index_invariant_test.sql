-- 96 — #229(b) invariant: every foreign key has a covering index (leading columns = the FK columns).
-- Migration 0096 sweeps the existing gaps; this pins the invariant so a FUTURE migration that adds an
-- unindexed FK fails CI (replacing the Supabase advisor's manual "unindexed FK" warning with a gate).
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(1);

select is(
  (select coalesce(string_agg(
      (c.conrelid::regclass)::text || '(' ||
      (select string_agg(a.attname, ',') from pg_attribute a
         where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) || ')', ', '), '')
   from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and not exists (
       select 1 from pg_index i
       where i.indrelid = c.conrelid
         and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
     )),
  '',
  '#229(b): every public FK has a covering index (no FK lacks a leading-column index)');

select * from finish();
rollback;
