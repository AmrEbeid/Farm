-- 56 — defensive invariant (recommended in the #270 H2 review): every audited table whose BASE-table
-- read is role-restricted (an authorize() call in its SELECT/ALL policy USING) must have its
-- entity_type gated in the audit_read policy — otherwise its audit_log mirror leaks the restricted data
-- to anyone with org membership (the H2 wage-leak class). Today only people_compensation qualifies and
-- 0053 gates it; this test FAILS if a future migration (a) gives another table a role-restricted read +
-- an fn_audit trigger without adding a matching audit_read clause, or (b) e.g. gives `people` an audit
-- trigger while its contact-PII columns stay restricted. It pins the whole class, not just the one case.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

-- (1) NON-VACUITY GUARD: the invariant below is only meaningful if the role_restricted detector
-- actually finds the known case (people_compensation). If this drops to 0 — e.g. a regex/policy-shape
-- change silently empties the detector — the main assertion would pass vacuously; this catches that.
with audited as (
  select distinct c.relname as tbl,
         (regexp_match(pg_get_triggerdef(t.oid), $re$fn_audit\('([a-z_]+)'\)$re$))[1] as entity_type
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and pg_get_triggerdef(t.oid) ~ $re$fn_audit\('[a-z_]+'\)$re$
)
select is(
  (select count(*)::int from audited a
     where a.entity_type = 'people_compensation'
       and exists (select 1 from pg_policies p
                   where p.schemaname='public' and p.tablename=a.tbl
                     and p.cmd in ('SELECT','ALL') and coalesce(p.qual,'') ilike '%authorize%')),
  1,
  'non-vacuity: the detector finds people_compensation as a role-restricted audited table');

-- (2) THE INVARIANT: no role-restricted audited table is left ungated in audit_read.
with audited as (
  -- tables with an fn_audit('<entity_type>') trigger; entity_type is the literal arg
  select distinct c.relname as tbl,
         (regexp_match(pg_get_triggerdef(t.oid), $re$fn_audit\('([a-z_]+)'\)$re$))[1] as entity_type
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and pg_get_triggerdef(t.oid) ~ $re$fn_audit\('[a-z_]+'\)$re$
),
role_restricted as (
  -- of those, the ones whose base-table READ (SELECT or ALL policy USING) is authorize()-gated
  select a.tbl, a.entity_type
  from audited a
  where exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = a.tbl
      and p.cmd in ('SELECT','ALL') and coalesce(p.qual,'') ilike '%authorize%'
  )
),
audit_gate as (
  select coalesce(qual,'') as g
  from pg_policies
  where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_read'
)
select is(
  (select count(*)::int
     from role_restricted r
     where not exists (select 1 from audit_gate where g like '%' || r.entity_type || '%')),
  0,
  'audit invariant: every role-restricted audited table has its entity_type gated in audit_read (no H2-class leak)');

select * from finish();
rollback;
